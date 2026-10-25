# OmniScope — 全能机器人与嵌入式集成调试平台

<div align="center">

**一套面向现代机器人研发、控制算法与嵌入式系统的全栈高内聚集成调试解决方案**

[架构体系](#-架构体系) •
[核心功能特性](#-核心功能特性) •
[快速上手指南](#-快速上手指南) •
[持续测试与在线长测](#-持续长测任务体系-test) •
[下位机-sdk-集成](#-下位机-sdk-集成)

</div>

---

## 📌 架构体系

工程清晰划分为**下位机（SDK）**、**上位机（Host）**与**持续长测套件（Test）**三大体系：

```
OmniScope/
├── sdk/                        # 【下位机组件库】嵌入式与机器人 C++ / C99 SDK
│   ├── CMakeLists.txt          # 现代组件化 CMake 导出 (OmniScope::All / Logger / MCU / RMBag / Calibrator)
│   ├── README.md               # 下位机 API 完整使用与组件文档
│   ├── include/omniscope/      # 公共头文件体系 (<omniscope/omniscope.hpp>, marker.hpp 等)
│   └── src/                    # 模块化私有实现 (logger/, mcu/, rmbag/, calibration/)
│
├── host/                       # 【上位机门户】统一现代化全栈调试看板 (Python + React)
│   ├── start.sh                # 上位机服务一键启动入口脚本
│   ├── _env.sh                 # 自动 Python 虚拟环境与依赖管理
│   ├── rdbg/                   # Python 核心后端 (HTTP Shell, UDP 发现, SSE 推流, .rlog 编解码)
│   │   ├── apps/               # Hub 服务门户 (hub_app.py)
│   │   ├── features/           # 可插拔功能模块 (watch, swd, replay, dump, calibrate)
│   │   └── static_ui/          # 前端单页应用 (SPA) 生产打包构建产物
│   └── ui/                     # 现代化前端源码 (Vite + React 18 + TypeScript + Three.js)
│       └── src/shared/         # 核心视口组件 (Scene3DView.tsx, DebugWorkbench.tsx 等)
│
├── test/                       # 【持续长测套件】100% 持续运行下位机数据源 (本地测试，不进 Git)
│   ├── CMakeLists.txt          # 测试工程 CMake 构建配置
│   ├── README.md               # 6 大持续测试任务详解与长时间在线观测指南
│   ├── test_common.hpp         # 测试通用网络与终端心跳工具
│   ├── test_3d_markers.cpp     # [长测 1] 全 10 种 ROS 2 3D Marker 空间运动展演
│   ├── test_telemetry_waveforms.cpp # [长测 2] 50Hz 多通道示波器遥测波形长测
│   ├── test_logs_console.cpp   # [长测 3] DEBUG/INFO/WARN/ERROR 结构化日志长测
│   ├── test_camera_stream.cpp  # [长测 4] OpenCV 瞄准 HUD 与标定棋盘格视频长测
│   ├── test_sentry_auto_aim.cpp# [长测 5] 哨兵自瞄 4 阶段拟真状态机全景长测
│   └── test_robot_fleet.cpp    # [长测 6] 三机编队独立端口集群长测
│
└── README.md                   # 本文档 (主工程指南)
```

---

## 🌟 核心功能特性

### 1. ROS 2 兼容 3D 空间可视化 (3D Viewport)
- **标准 RViz2 体验**：基于 Three.js 实现右手 Z-Up 工业级 3D 坐标系，内置暗色网格与原点三轴。
- **极简纯净工作台**：去除顶部冗余控制条，四分屏全幅展开，每个视口独立具备最大化、还原与类型切换控制。
- **支持 10 种标准 ROS 2 Marker 图元**：
  - 基础几何：`ARROW` (箭头), `CUBE` (立方体), `SPHERE` (球体), `CYLINDER` (圆柱体)。
  - 连续轨迹与线条：`LINE_STRIP` (连续折线/轨迹曲线), `LINE_LIST` (成对射线/激光束)。
  - 列表与体素点云：`CUBE_LIST` (三维体素网格), `SPHERE_LIST` (多球环), `POINTS` (激光点云)。
  - 文字与表面：`TEXT_VIEW_FACING` (相机面向文本标签), `TRIANGLE_LIST` (多边形表面)。
- **增量 RAF 渲染机制**：采用 `requestAnimationFrame` 批量增量更新，杜绝频繁网格销毁重建，数小时连续运行保持稳定 60 FPS 与极低内存占用。

### 2. 实时多通道示波器 (Telemetry Oscilloscope)
- 以最高 200Hz 频率实时采样并绘制多通道浮点波形（目标角度、实际追踪、误差、速度、电流、功率等）。
- 具备严格的历史窗口截断与自动滚动机制，杜绝长跑内存膨胀。
- 支持前端自定义派生函数公式（如求导、比例变换）。

### 3. 虚拟化结构化日志控制台 (Log Console)
- 实时推送带时间戳与色彩高亮的分级日志（`DEBUG`, `INFO`, `WARN`, `ERROR`）。
- 具备自动滚动、快速过滤与 2000 行环形缓冲区保护。

### 4. 视觉相机推流与内参标定 (Vision & Calibration)
- 实时 JPEG 压缩图传，毫秒级网络回传机器人相机第一视角。
- 支持平视显示准星（HUD）、目标包围盒与角点自动提取的单目相机内参标定。

### 5. 非侵入式 SWD 变量监视与热整定 (SWD Hardware Probe)
- 基于 OpenOCD Telnet 通讯，无需 halt CPU 即可在 MCU 运行时以 20~50Hz 周期读取/写入全局变量与结构体内存快照。

### 6. 会话录放与离线转码 (.rlog RMBag Replay & Dump)
- 高性能二进制记录引擎，纳秒级对齐。
- 支持时间轴回放与一键转码导出为 CSV / MP4 视频。

---

## 🚀 快速上手指南

### 步骤 1：启动上位机调试门户
确保环境已安装 Python 3.9+：
```bash
./host/start.sh --port 8080
```
启动后终端显示：
```text
[hub] http://127.0.0.1:8080/
[discover] listening on UDP 0.0.0.0:15999
```
服务在本地启动 Web 门户（HTTP `8080`）与 UDP 设备自动发现监听（`15999`）。

### 步骤 2：启动持续测试数据源（任选一项）
```bash
# 推荐：启动自瞄拟真状态机持续长测
./test/build/test_sentry_auto_aim

# 或：启动全 10 种 3D 图元动态运动长测
./test/build/test_3d_markers
```

### 步骤 3：在浏览器中打开观测
直接访问 `http://127.0.0.1:8080/` 即可看到发现的车辆卡片；或直接进入单车专属视口：
- **自瞄综合视口**：`http://127.0.0.1:8080/?feature=watch&sender=sentry_auto_aim`
- **3D 标记全景视口**：`http://127.0.0.1:8080/?feature=watch&sender=test_3d_markers`

---

## 🧪 持续长测任务体系 (test/)

`test/` 目录中的所有程序均为**持续运行的守护程序 (Continuous Tasks)**，不跑几行就退出，专门用于长时间人机交互与观察：

```bash
cd test
cmake -B build && cmake --build build -j
```

| 目标命令 | 端口 | 特性说明 |
| :--- | :--- | :--- |
| `./test/build/test_3d_markers` | 15001 | 30Hz 持续广播 11 种 3D Marker，测试空间坐标变换与视口渲染 |
| `./test/build/test_telemetry_waveforms` | 15002 | 50Hz 持续高频遥测波形（多频正弦、二阶 PID 超调、阶跃、电流） |
| `./test/build/test_logs_console` | 15003 | 10Hz 持续分级业务日志推流（各子模块运行状态与报警） |
| `./test/build/test_camera_stream` | 15004 | 30FPS 持续 OpenCV 准星 HUD 与棋盘格标定图案交替视频流 |
| `./test/build/test_sentry_auto_aim` | 15000 | 哨兵自瞄 4 阶段状态机（巡逻扫描、捕获逼近、锁定射击弹道抛物线、规避） |
| `./test/build/test_robot_fleet` | 15000~15004 | 三机编队独立端口集群协同长测 |

> 完整任务设计与长时间观测手册请查阅：[`test/README.md`](test/README.md)。

---

## 📦 下位机 SDK 集成

在外部机器人算法工程的 `CMakeLists.txt` 中引入：

```cmake
add_subdirectory(path/to/OmniScope/sdk)
target_link_libraries(your_robot_node PRIVATE OmniScope::All)
```

在 C++ 代码中调用：

```cpp
#include <omniscope/omniscope.hpp>

int main() {
    // 1. 初始化遥测引擎
    omniscope::RemoteLogger::Config cfg;
    cfg.sender_name = "sentry_auto_aim";
    cfg.control_port = 15000;
    omniscope::init(cfg);

    // 2. 实时打印波形 (极简一行)
    omniscope::plot({{"yaw_deg", 18.5}, {"pitch_deg", -4.2}});

    // 3. 实时输出分级日志
    omniscope::info("Target acquired: dist={:.2f}m", 2.34);

    // 4. 实时发布 3D Marker (使用 Fluent 工厂构造器)
    auto arrow = omniscope::Marker::make_arrow({0, 0, 0.3f}, {2.0f, 1.0f, 0.5f})
                    .set_ns("gimbal").set_id(1);
    omniscope::plot_marker(arrow);

    // 5. 实时图像推流
    omniscope::plot_image(camera_bgr, {{"name", "sentry_hud"}});
}
```

> 完整 SDK 接口文档请查阅：[`sdk/README.md`](sdk/README.md)。

---

## 🛠️ 前端修改与构建

若修改了 `host/ui/src/` 中的前端代码，执行构建脚本即可打包生产产物：

```bash
./host/ui/build.sh
```
产物将自动编译并输出至 `host/rdbg/static_ui/`，无需重启 Python 后端，刷新浏览器页面即可生效。

---

## 📝 规范要求
**后续所有代码更新与架构变动，均必须同步更新工程根目录 `README.md` 与对应子目录 `README.md`。**
