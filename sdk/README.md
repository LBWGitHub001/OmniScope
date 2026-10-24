# OmniScope Modern C++ & Embedded SDK

OmniScope 下位机 SDK 面向机器人车载工控机（Linux / ROS / Jetson）、嵌入式微控制器（STM32 / Cortex-M 系列）及控制算法工程，提供标准化、高内聚的组件库与现代化公共头文件体系。

---

## 1. 架构与目录组织

SDK 统一收敛公共暴露接口（Public Headers）与内部私有实现（Private Sources），所有头文件统一位于 `include/omniscope/`，所有实现源码位于 `src/`：

```
sdk/
├── CMakeLists.txt                         # 统一现代 CMake：组件化配置与安装导出 (Modern CMake Package)
├── README.md                              # 本文档
│
├── include/                               # 【统一公共头文件根目录】
│   └── omniscope/
│       ├── omniscope.hpp                  # 【统揽头文件】现代极简 API、便捷函数与流畅 Marker 构造
│       ├── logger.hpp                     # 遥测核心客户端（RemoteLogger 类定义）
│       ├── remote_logger.hpp              # 兼容性头文件别名
│       ├── marker.hpp                     # ROS 2 兼容 3D Marker 定义 + Fluent Static Builders
│       ├── mcu/
│       │   └── mailbox.h                  # 单片机 SWD 纯 C99 内存邮箱与热整定快照
│       ├── rmbag/                         # 满帧率视觉姿态数据集录放库公共头文件
│       │   ├── proto.hpp                  # RMB1 数据格式协议 (纳秒对齐、四元数、欧拉角)
│       │   ├── meta.hpp                   # 录制元信息与统计采集
│       │   ├── reader.hpp                 # 数据集读取器
│       │   ├── writer.hpp                 # 高吞吐无损写盘器
│       │   └── playback.hpp               # 硬件在环回放器
│       └── calibration/                   # 相机与手眼标定公共头文件
│           ├── calibrator.hpp             # 棋盘格四维覆盖度标定算法
│           └── test_feed.hpp              # 虚拟棋盘格仿真数据源
│
└── src/                                   # 【统一源码实现根目录】
    ├── logger/                            # 遥测实现 (UDP 传输、协议引擎、图像压缩、异步落盘)
    │   ├── internal/*.hpp
    │   └── *.cpp
    ├── mcu/                               # MCU 纯 C 实现 (零 CPU 暂停 SWD 通讯)
    │   └── mailbox.c
    ├── rmbag/                             # RMBag 数据集读写源码
    │   └── *.cpp
    └── calibration/                       # 标定算法与独立可执行标定节点
        ├── calibrator.cpp
        └── calibrate_node.cpp
```

---

## 2. CMake 引入使用

### 方式 A：源码子目录方式 (`add_subdirectory`)

在机器人或算法工程的 `CMakeLists.txt` 中添加：

```cmake
# 引入 SDK 子目录
add_subdirectory(path/to/OmniScope/sdk)

# 一键链接全部组件（统一接口）
target_link_libraries(your_robot_target PRIVATE OmniScope::All)

# 或者按需链接具体模块
target_link_libraries(your_robot_target PRIVATE OmniScope::Logger)
target_link_libraries(your_mcu_target   PRIVATE OmniScope::MCU)
target_link_libraries(your_vision_target PRIVATE OmniScope::RMBag)
target_link_libraries(your_calib_target  PRIVATE OmniScope::Calibrator)
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

## 3. C++ 现代调用示例

### 极简统揽头文件 (`<omniscope/omniscope.hpp>`)

推荐直接包含统揽头文件，即可享受极简顶层 API：

```cpp
#include <omniscope/omniscope.hpp>

int main() {
    // 1. 初始化遥测引擎
    omniscope::RemoteLogger::Config cfg;
    cfg.sender_name = "sentry_robot";
    omniscope::init(cfg);

    // 2. 实时高频上报多通道波形（极简一行）
    omniscope::plot({
        {"yaw", 12.5},
        {"pitch", -3.2},
        {"speed", 28.0}
    });

    // 3. 结构化日志打印（原生支持 fmt 占位符）
    omniscope::info("Armor detected at distance: {:.2f}m", 3.45);
    omniscope::warn("Approaching gimbal limit: angle={:.1f}deg", 48.5);

    // 4. 发送 3D 可视化标记（使用便捷工厂构建器）
    omniscope::plot_marker(
        omniscope::Marker::make_arrow({0, 0, 0}, {2.0f, 0.5f, 0.0f})
            .set_ns("trajectory")
            .set_id(1)
            .set_lifetime(0.5f)
    );

    omniscope::plot_marker(
        omniscope::Marker::make_cube({2.0f, 0.5f, 0.0f}, {0.3f, 0.3f, 0.3f})
            .set_ns("target_box")
    );

    omniscope::plot_marker(
        omniscope::Marker::make_text({2.0f, 0.5f, 0.4f}, "Target #1")
    );

    // 5. 实时图像回传（自动限频与 JPEG 压缩）
    cv::Mat frame = ...;
    omniscope::plot_image(frame, {{"name", "sentry_main_camera"}});

    omniscope::shutdown();
    return 0;
}
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
        // 主循环中检查上位机是否有新参数下发 (SWD 在线调参，零 CPU 暂停)
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

---

## 5. 满帧率视觉姿态录制 (`OmniScope::RMBag`)

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
