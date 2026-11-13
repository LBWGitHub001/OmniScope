# OmniScope SDK（C++ 版与嵌入式版）

OmniScope 下位机 SDK 分为两个版本：

- **C++ 版（`OmniScope::Cpp`）**：面向机器人车载工控机（Linux / ROS / Jetson）与控制算法工程，提供 UDP 遥测、结构化日志、ROS 2 兼容 3D Marker、图像推流、.rmbag 录放与相机标定。
- **嵌入式版（`OmniScope::Embedded`）**：面向 STM32 / Cortex-M 等裸机与 RTOS 工程，提供纯 C99 的 SWD 内存邮箱与高速迹缓冲，配合上位机实现不停机在线调参与瞬态采样。

两个版本在同一次 CMake 配置中都会生成。你的工程链接哪个目标，就使用哪个版本：

```cmake
target_link_libraries(robot_node PRIVATE OmniScope::Cpp)      # 用 C++ 版
target_link_libraries(mcu_fw     PRIVATE OmniScope::Embedded) # 用嵌入式版
```

---

## 1. 目录组织

```
sdk/
├── CMakeLists.txt                  # 顶层：add_subdirectory(cpp|embedded) 与安装导出
├── cmake/
│   └── OmniScopeConfig.cmake.in    # find_package(OmniScope) 包配置模板
│
├── cpp/                            # 【C++ 版】OmniScope::Cpp
│   ├── CMakeLists.txt
│   ├── include/omniscope/
│   │   ├── omniscope.hpp           # 统揽头：init/plot/log/plot_marker/plot_image/poll_json
│   │   ├── logger.hpp              # 遥测客户端（remote_logger.hpp 兼容别名）
│   │   ├── remote_logger.hpp
│   │   ├── marker.hpp              # ROS 2 兼容 3D Marker + Fluent Builders
│   │   ├── rmbag/                  # 视觉姿态数据集录放（proto/meta/reader/writer/playback）
│   │   └── calibration/            # 棋盘格标定算法与仿真数据源
│   └── src/
│       ├── logger/                 # UDP 传输、协议引擎、图像压缩（含 internal/*.hpp）
│       ├── rmbag/                  # 数据集读写实现
│       └── calibration/            # 标定算法与 omniscope_calibrate 节点
│
└── embedded/                       # 【嵌入式版】OmniScope::Embedded
    ├── CMakeLists.txt
    ├── include/omniscope/mcu/
    │   └── mailbox.h               # 纯 C99：调参邮箱 + 高速迹缓冲 + SeqLock
    └── src/
        └── mailbox.c
```

---

## 2. CMake 引入使用

### 方式 A：源码子目录（`add_subdirectory`）

```cmake
add_subdirectory(path/to/OmniScope/sdk)

# 主机端机器人/算法工程 → 链接 C++ 版
target_link_libraries(your_robot_target PRIVATE OmniScope::Cpp)

# 单片机固件工程（交叉编译时建议单独配置）→ 链接嵌入式版
target_link_libraries(your_mcu_target   PRIVATE OmniScope::Embedded)
```

### 方式 B：安装后 `find_package`

```bash
cmake -S sdk -B sdk/build && cmake --build sdk/build
cmake --install sdk/build --prefix /opt/omniscope
```

```cmake
find_package(OmniScope CONFIG REQUIRED)
target_link_libraries(your_target PRIVATE OmniScope::Cpp)       # 或 OmniScope::Embedded
```

C++ 版的第三方依赖（Threads、OpenCV、fmt、nlohmann_json、yaml-cpp、Eigen3）会在 `find_package(OmniScope)` 时自动查找；标定模块在找到 Eigen3、yaml-cpp、nlohmann_json 时自动编入并生成 `omniscope_calibrate` 可执行节点。

嵌入式版无任何第三方依赖，只要求 C99 编译器，适合交叉工具链直接编译。

---

## 3. C++ 版调用示例（`OmniScope::Cpp`）

```cpp
#include <omniscope/omniscope.hpp>

int main() {
    // 1. 初始化遥测引擎
    omniscope::RemoteLogger::Config cfg;
    cfg.sender_name = "sentry_robot";
    omniscope::init(cfg);

    // 2. 实时高频上报多通道波形
    omniscope::plot({{"yaw", 12.5}, {"pitch", -3.2}, {"speed", 28.0}});

    // 3. 结构化日志（支持 fmt 占位符）
    omniscope::info("Armor detected at distance: {:.2f}m", 3.45);
    omniscope::warn("Approaching gimbal limit: angle={:.1f}deg", 48.5);

    // 4. 发送 3D 可视化标记
    omniscope::plot_marker(
        omniscope::Marker::make_arrow({0, 0, 0}, {2.0f, 0.5f, 0.0f})
            .set_ns("trajectory")
            .set_id(1)
            .set_lifetime(0.5f)
    );

    // 5. 实时图像回传（自动限频与 JPEG 压缩）
    cv::Mat frame = cv::imread("frame.jpg");
    omniscope::plot_image(frame, {{"name", "sentry_main_camera"}});

    omniscope::shutdown();
    return 0;
}
```

视觉姿态数据集录制使用 `<omniscope/rmbag/writer.hpp>`，硬件在环回放使用 `<omniscope/rmbag/playback.hpp>`。

---

## 4. 嵌入式版调用示例（`OmniScope::Embedded`）

在 STM32 / FreeRTOS 纯 C 工程中链接 `OmniScope::Embedded`（也可以直接把 `mailbox.h` 与 `mailbox.c` 加入固件工程的源文件列表）：

```c
#include <omniscope/mcu/mailbox.h>

omniscope_mailbox_t g_tuning_mailbox;
omniscope_trace_buffer_t g_trace_buffer;

void main(void) {
    omniscope_mailbox_init(&g_tuning_mailbox);
    omniscope_trace_init(&g_trace_buffer);

    while (1) {
        // 主循环检查上位机是否有新参数下发（SWD 在线调参，零 CPU 暂停）
        if (omniscope_mailbox_has_update(&g_tuning_mailbox)) {
            pid_kp = omniscope_mailbox_get_param(&g_tuning_mailbox, 0, 1.0f);
            pid_ki = omniscope_mailbox_get_param(&g_tuning_mailbox, 1, 0.0f);
            pid_kd = omniscope_mailbox_get_param(&g_tuning_mailbox, 2, 0.1f);
            omniscope_mailbox_acknowledge(&g_tuning_mailbox);
        }
    }
}

// 高频控制中断（1kHz ~ 10kHz）中记录微秒级采样
void Control_ISR(void) {
    float channels[OMNISCOPE_TRACE_CHANNELS] = {target_val, current_val, pid_out, current_iq};
    omniscope_trace_record(&g_trace_buffer, get_micros(), channels);
}
```

---

## 4.1 plot 命名通道推送（`omniscope/mcu/plot.h`，header-only）

调用即"发送"：固件把 `(时间戳, 通道, 值)` 推入 SRAM 中的命名通道 FIFO，上位机经 SWD 按单调序号排空并绘制波形，全程不 halt CPU。全部 API 为 `static inline`，零依赖、零 .c 文件。

```c
/* 时间戳源宏必须在 include 前定义 (默认 0, 上位机退化为接收时刻) */
#define OMNISCOPE_PLOT_TIMESTAMP_US() (HAL_GetTick() * 1000U)
#include <omniscope/mcu/plot.h>

omniscope_plot_t g_omniscope_plot;   /* 约定符号名, 上位机自动发现 */

void main(void) {
    omniscope_plot_init(&g_omniscope_plot);
    while (1) {
        OMNISCOPE_PLOT(&g_omniscope_plot, "gimbal.yaw", yaw_deg);   // 首次调用自动注册通道
        OMNISCOPE_PLOT(&g_omniscope_plot, "gimbal.pitch", pitch_deg);
    }
}
```

- 16 个命名通道（名 24B）+ 512 点 FIFO（16B/点），合计 8668B SRAM；`OMNISCOPE_PLOT_FIFO_SIZE` 等容量宏可在 include 前覆盖
- 上位机排空后回写 `read_seq`，固件侧统计 `dropped`（被覆盖的未读点数）

**内存布局（上位机对齐依据，`_Static_assert` 锁定）**

| 偏移 | 字段 |
|---|---|
| 0 / 4 / 8 | magic `"OMPL"` / version / write_seq |
| 12 / 16 / 20 / 24 | read_seq（上位机回写）/ dropped / fifo_size / channel_count |
| 28 | channels[16]：`char name[24]; u32 active`（28B/项） |
| 476 | points[512]：`{seq, ts_us, channel, value}`（16B/点） |

---

## 4.2 watch 监视与参数表（`omniscope/mcu/watch.h`，header-only）

固件声明、上位机自动发现的一张统一表：只读监视标量、版本门控的大数组（雷达回波矩阵等）、上位机滑杆直写的参数项。

```c
#include <omniscope/mcu/watch.h>

omniscope_watch_table_t g_omniscope_watch;   /* 约定符号名, 上位机自动发现 */
static float g_pid_kp = 1.0f;
static float g_echo[64][64];

void main(void) {
    omniscope_watch_init(&g_omniscope_watch);

    // 参数项: 上位机渲染滑杆, mww 直写并钳制到 [0, 10], 步进 0.1, 1Hz 回显
    omniscope_watch_register_param(&g_omniscope_watch, "pid.kp", &g_pid_kp,
                                   OMNISCOPE_TYPE_F32, 0.0f, 10.0f, 0.1f);

    // 只读监视标量: 上位机 30Hz 轮询, UI 无写入入口, 后端 403 拒绝写入
    omniscope_watch_register_scalar(&g_omniscope_watch, "sys.uptime_s", &g_uptime,
                                    OMNISCOPE_TYPE_U32);

    // 大数组监视(强制只读): 上位机每轮只读 4B 版本号, 变了才在空闲带宽分块拉取
    int idx = omniscope_watch_register_array(&g_omniscope_watch, "radar.echo", &g_echo[0][0],
                                             OMNISCOPE_TYPE_F32, 64, 64);
    omniscope_watch_set_range(&g_omniscope_watch, idx, 0.0f, 8.0f);  // 热图色标, 0=自适应

    while (1) {
        update_echo(g_echo);
        omniscope_watch_touch(&g_omniscope_watch, idx);   // 数据更新完 bump 版本号
    }
}
```

- 类型枚举：`OMNISCOPE_TYPE_F32/I32/U32/I16/U16/I8/U8`；`kind`：0=监视 / 1=参数；`access`：监视恒 RO、参数恒 RW
- 32 项容量，表项 52B，整表 1680B

**表项布局（52B，上位机对齐依据）**：`name[24]` @0、`ptr` @24、`elem_type/kind/access/flags` @28、`rows/cols` @32、`version` @36、`min/max/step` @40。表头 16B：magic `"OMWT"` / version / count / capacity。

**上位机带宽调度**（`host/rdbg/features/swd.py`）：总额度 `rate_limit_bps`（默认 8192 B/s，门户设置可调）；优先级 `参数读取(1Hz) > 监视标量(30Hz, 1~50可调) > plot FIFO 排空(空闲) > 数组 payload(空闲+版本门控, 每 tick 一个 256B 分块)`。

---

## 5. 版本选择说明

- 两个目标互不依赖：链接 `OmniScope::Cpp` 不会引入 `mailbox.h`，链接 `OmniScope::Embedded` 不会引入任何 C++ 头文件与第三方库。
- 同一个上位机工程同时包含车载节点与固件子工程时，可以分别链接两个目标。
- 嵌入式固件建议用对应的交叉工具链（如 `arm-none-eabi-gcc`）单独 `cmake -S sdk -B build-mcu -DCMAKE_TOOLCHAIN_FILE=...`，只编译 `omniscope_embedded` 目标即可。
