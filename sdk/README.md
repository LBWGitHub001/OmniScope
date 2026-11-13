# OmniScope SDK（C++ 版与嵌入式版）

OmniScope 下位机 SDK 分为两个版本，详细文档各自独立：

- **[C++ 版完整文档 → `cpp/README.md`](cpp/README.md)**（`OmniScope::Cpp`）
  面向机器人车载工控机（Linux / ROS / Jetson）与控制算法工程，提供 UDP 遥测波形、结构化日志、ROS 2 兼容 3D Marker、图像推流、上位机反向控制、`.rmbag` 数据集录放与相机标定。
- **[嵌入式版完整文档 → `embedded/README.md`](embedded/README.md)**（`OmniScope::Embedded`）
  面向 STM32 / Cortex-M 等裸机与 RTOS 工程，纯 C99 零依赖：SWD 调参邮箱、命名通道波形推送、变量监视/参数表与高速迹缓冲，上位机经 OpenOCD 不 halt CPU 读写。

两个版本在同一次 CMake 配置中都会生成，互不依赖。你的工程链接哪个目标，就使用哪个版本：

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
├── cpp/                            # 【C++ 版】OmniScope::Cpp —— 文档见 cpp/README.md
│   ├── include/omniscope/
│   │   ├── omniscope.hpp           # 统揽头：init/plot/log/plot_marker/plot_image/poll_json
│   │   ├── logger.hpp              # 遥测客户端（remote_logger.hpp 兼容别名 Logger）
│   │   ├── remote_logger.hpp       # RemoteLogger 单例遥测引擎
│   │   ├── marker.hpp              # ROS 2 兼容 3D Marker + Fluent Builders
│   │   ├── rmbag/                  # 视觉姿态数据集录放（proto/meta/reader/writer/playback）
│   │   └── calibration/            # 棋盘格标定仿真数据源
│   └── src/
│       ├── logger/                 # UDP 传输、协议引擎、图像压缩（含 internal/*.hpp）
│       ├── rmbag/                  # 数据集读写实现
│       └── calibration/            # 标定算法与 omniscope_calibrate 节点
│
└── embedded/                       # 【嵌入式版】OmniScope::Embedded —— 文档见 embedded/README.md
    ├── include/omniscope/mcu/
    │   ├── mailbox.h               # 调参邮箱 + 高速迹缓冲 + SeqLock
    │   ├── plot.h                  # 命名通道推送 FIFO（header-only）
    │   └── watch.h                 # 监视与参数表（header-only）
    └── src/
        └── mailbox.c               # 唯一的 .c 实现文件
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

C++ 版的第三方依赖（Threads、OpenCV、fmt、nlohmann_json、yaml-cpp、Eigen3）会在引入时自动查找；标定模块在找到 Eigen3、yaml-cpp、nlohmann_json 时自动编入并生成 `omniscope_calibrate` 可执行节点。嵌入式版无任何第三方依赖，只要求 C99 编译器，适合交叉工具链直接编译。

---

## 3. 最小示例

C++ 版（完整示例见 [`cpp/README.md` § 4](cpp/README.md)）：

```cpp
#include <omniscope/omniscope.hpp>

int main() {
    omniscope::RemoteLogger::Config cfg;
    cfg.sender_name = "sentry_robot";
    omniscope::init(cfg);

    omniscope::plot({{"yaw", 12.5}, {"pitch", -3.2}});
    omniscope::info("Target acquired: dist={:.2f}m", 2.34);
    omniscope::shutdown();
}
```

嵌入式版（完整示例见 [`embedded/README.md` § 4](embedded/README.md)）：

```c
#define OMNISCOPE_PLOT_TIMESTAMP_US() (HAL_GetTick() * 1000U)
#include <omniscope/mcu/plot.h>
#include <omniscope/mcu/watch.h>

omniscope_plot_t g_omniscope_plot;          /* 约定符号名, 上位机自动发现 */
omniscope_watch_table_t g_omniscope_watch;

int main(void) {
    omniscope_plot_init(&g_omniscope_plot);
    omniscope_watch_init(&g_omniscope_watch);
    while (1) {
        OMNISCOPE_PLOT(&g_omniscope_plot, "gimbal.yaw", yaw_deg);
    }
}
```

---

## 4. 版本选择说明

- 两个目标互不依赖：链接 `OmniScope::Cpp` 不会引入 `omniscope/mcu/*.h`，链接 `OmniScope::Embedded` 不会引入任何 C++ 头文件与第三方库。
- 同一个工程同时包含车载节点与固件子工程时，可以分别链接两个目标。
- 嵌入式固件建议用对应的交叉工具链（如 `arm-none-eabi-gcc`）单独 `cmake -S sdk -B build-mcu -DCMAKE_TOOLCHAIN_FILE=...`，只编译 `omniscope_embedded` 目标即可。
