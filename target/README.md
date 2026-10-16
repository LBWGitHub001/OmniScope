# Target 嵌入式/车端运行 SDK

本目录包含附属在机器人/算法端代码中的下位机 C++ 模块：

## 1. 模块说明

- **`logger/` (RemoteLogger & rdbg C++ Core)**:
  - 车载调试日志与遥测发送端。
  - 支持向上位机单播发送实时 plot 变量（JSON）、日志信息、OpenCV 压缩 JPEG 图像流。
  - 支持本地无阻塞异步落盘 `.rlog`（RLG2 格式）。
  - 支持 LAN UDP Beacon（`:15999`）常驻广播发现与 Host 排队转发控制协议。
- **`rmbag/` (RMB1 数据集录放库)**:
  - 针对高动态视觉与云台算法设计。
  - 记录满帧率无压缩 BGR8 图像与毫秒/纳秒对齐的云台四元数（`q_w, q_x, q_y, q_z`）、欧拉角及工作模式。
  - 支持作为假数据源进行硬件在环回放调试。

## 2. 引入使用

在机器人的主工程 `CMakeLists.txt` 中引入：

```cmake
add_subdirectory(target)
target_link_libraries(your_robot_target PRIVATE target_logger target_rmbag)
```

代码中调用：

```cpp
#include "tools/remote_logger.hpp"

// 初始化
tools::RemoteLogger::instance().init(config);

// 实时打印变量与曲线
tools::RemoteLogger::instance().plot({{"yaw", current_yaw}, {"pitch", current_pitch}});

// 实时日志
tools::RemoteLogger::instance().log("INFO", "Target tracked: id={}", target_id);

// 实时图像发送与录制
tools::RemoteLogger::instance().plot_image(mat_bgr, {{"name", "raw"}});
```
