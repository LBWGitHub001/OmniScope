# OmniScope C++ & Embedded SDK

OmniScope 下位机 SDK 面向机器人车载工控机（Linux / ROS / Jetson）、嵌入式微控制器（STM32 / Cortex-M 系列）及控制算法工程，提供标准化、高内聚的组件库与公共头文件体系。

---

## 1. 架构与模块分类

SDK 内部严格遵循现代 C++ 规范，将**公共暴露接口（Public Headers）**与**内部私有实现（Private Sources / Internal Headers）**隔离，所有组件归属在 `omniscope::` 命名空间下：

```
sdk/
├── CMakeLists.txt                      # 顶层 CMake：统一版本管理、模块发现与安装导出 (Modern CMake Package)
├── README.md                           # 本文档
│
├── mcu/                                # 【单片机纯 C 库】(OmniScope::MCU)
│   ├── CMakeLists.txt
│   ├── README.md                       # 单片机移植详细文档
│   ├── include/omniscope/mcu/
│   │   └── mailbox.h                   # SWD 在线热整定、微秒级示波器环形缓冲、SeqLock 快照
│   └── src/
│       └── mailbox.c                   # 纯 C99 实现源码
│
├── logger/                             # 【遥测与远程日志库】(OmniScope::Logger)
│   ├── CMakeLists.txt
│   ├── include/omniscope/
│   │   ├── remote_logger.hpp           # 核心遥测接口类 omniscope::RemoteLogger
│   │   └── logger.hpp                  # 便捷类型别名
│   └── src/
│       ├── internal/*.hpp              # 内部协议、UDP传输、JPEG压缩与落盘私有头文件
│       └── *.cpp                       # 遥测实现源码
│
└── rmbag/                              # 【视觉与姿态数据集录放库】(OmniScope::RMBag)
    ├── CMakeLists.txt
    ├── README.md                       # RMB1 数据格式与录放详解
    ├── include/omniscope/rmbag/
    │   ├── proto.hpp                   # RMB1 数据格式协议 (纳秒对齐、四元数、欧拉角)
    │   ├── meta.hpp                    # 录制元信息与统计采集
    │   ├── reader.hpp                  # 数据集读取器
    │   ├── writer.hpp                  # 高吞吐无损写盘器
    │   └── playback.hpp                # 硬件在环回放器
    └── src/*.cpp                       # 数据集录放实现源码
```

---

## 2. CMake 引入使用

### 方式 A：源码子目录方式 (`add_subdirectory`)

在机器人或算法工程的 `CMakeLists.txt` 中添加：

```cmake
# 引入 SDK 子目录
add_subdirectory(path/to/OmniScope/sdk)

# 一键链接全部组件
target_link_libraries(your_robot_target PRIVATE OmniScope::All)

# 或者只针对单片机工程链接纯 C 库
target_link_libraries(your_mcu_target PRIVATE OmniScope::MCU)
```

### 方式 B：现代包导入方式 (`find_package`)

在编译并 `make install` 之后，在外部工程的 `CMakeLists.txt` 中：

```cmake
# 自动发现 OmniScope Package
find_package(OmniScope CONFIG REQUIRED)

# 链接目标
target_link_libraries(your_target PRIVATE OmniScope::All)
```

---

## 3. C++ 车端调用示例

### 遥测与远程日志 (`OmniScope::Logger`)

```cpp
#include <omniscope/remote_logger.hpp>

// 1. 初始化遥测引擎
omniscope::RemoteLogger::instance().init(config_or_yaml_path);

// 2. 实时打印多通道变量曲线 (Host 门户实时波形呈现)
omniscope::RemoteLogger::instance().plot({
    {"yaw", current_yaw},
    {"pitch", current_pitch},
    {"speed", current_speed}
});

// 3. 打印等级日志 (支持 fmt 格式化)
omniscope::RemoteLogger::instance().log("INFO", "Robot initialized successfully: id={}", robot_id);

// 4. 实时图像回传与本地异步落盘
omniscope::RemoteLogger::instance().plot_image(mat_bgr, {{"name", "raw"}});
```

### 满帧率视觉姿态录制 (`OmniScope::RMBag`)

```cpp
#include <omniscope/rmbag/writer.hpp>

omniscope::rmbag::Writer writer;
writer.open("records/session.rmbag");
writer.write_header(header_json);

omniscope::rmbag::Frame frame;
frame.hdr.ts_ns = get_now_ns();
frame.hdr.q_w = q.w(); frame.hdr.q_x = q.x(); frame.hdr.q_y = q.y(); frame.hdr.q_z = q.z();
frame.hdr.width = 1280; frame.hdr.height = 1024; frame.hdr.step = 1280 * 3;
frame.hdr.data_len = frame.hdr.step * frame.hdr.height;
frame.pixels = std::move(raw_bgr8_bytes);

writer.write_frame(frame);
```

---

## 4. 单片机嵌入式调用 (`OmniScope::MCU`)

在 STM32 / FreeRTOS 纯 C 工程中，直接引入头文件并链接 `OmniScope::MCU`（或直接将 `mailbox.h` 与 `mailbox.c` 加入工程源文件列表）：

```c
#include "omniscope/mcu/mailbox.h"

omniscope_mailbox_t g_tuning_mailbox;
omniscope_trace_buffer_t g_trace_buffer;

void main(void) {
    omniscope_mailbox_init(&g_tuning_mailbox);
    omniscope_trace_init(&g_trace_buffer);

    while (1) {
        // 主循环中检查上位机是否有新参数下发 (SWD 在线调参)
        if (omniscope_mailbox_has_update(&g_tuning_mailbox)) {
            pid_kp = omniscope_mailbox_get_param(&g_tuning_mailbox, 0, 1.0f);
            pid_ki = omniscope_mailbox_get_param(&g_tuning_mailbox, 1, 0.0f);
            pid_kd = omniscope_mailbox_get_param(&g_tuning_mailbox, 2, 0.1f);
            omniscope_mailbox_acknowledge(&g_tuning_mailbox);
        }
    }
}

// 在高频控制中断（1kHz ~ 10kHz）中记录微秒级采样
void Control_ISR(void) {
    float channels[OMNISCOPE_TRACE_CHANNELS] = {target_val, current_val, pid_out, current_iq};
    omniscope_trace_record(&g_trace_buffer, get_micros(), channels);
}
```
