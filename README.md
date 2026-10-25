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

### 1. 卡片上下文联动设置栏与严肃工业 UI (Context-Aware Sidebar & Serious UI)
- **卡片焦点智能路由**：多分屏视口支持点击快速聚焦（呈现青色外发光高亮边框），左侧设置栏与底部状态栏自适应呈现当前卡片的专属控制面板与运行状态。
- **3D 空间专业调试面板 (3D Viewport Sidebar)**：
  - **三轴粗短立体指示箭头**：原点坐标系采用粗短立体 3D 箭头（长度 0.8m，轴径 0.03m，锥头 0.08m，红 X 前向 / 绿 Y 左向 / 蓝 Z 天向），具备金属质感与视角高辨识度，支持开关显隐。
  - **基准坐标系**：定义 `base_link` 为机器人运动基准，明晰标注右手坐标系定义。
  - **地面参考网格**：支持独立开关显隐与 10m / 20m / 50m 尺寸步长实时切换。
  - **命名空间与物体级下拉过滤**：提供命名空间下拉选框（可切换指定空间或查看全部），下方实时列出该空间内所有回传的具体图元物体（图元 ID、几何类型 `ARROW/CUBE/SPHERE` 等、文本标签与专属颜色），支持单物体复选框独立显隐及「全显 / 全隐」快捷操作。
  - **多角度相机预设**：一键切换「透视视角」、「顶视 / 俯视 (XY 面)」、「正前视角 (XZ 面)」、「正侧视角 (YZ 面)」与「复位视角」。
  - **空间图元分类统计**：实时统计活动 Marker 总数及各几何类型的数量分布，支持一键清空空间所有标记。
- **示波器曲线设置面板 (Waveform Plot Sidebar)**：
  - 支持滑动 (Sliding)、居中追踪 (Centered) 与暂停 (Paused) 观测模式。
  - 自定义时间采样窗口 (1~120s) 与历史截断长度 (30s~5min)。
  - 多通道字段色彩标识与显隐勾选，支持内置虚拟公式通道 ƒ(x) 在线推导。
- **实时图像专业调试面板 (Live Vision & Image Sidebar)**：
  - **视频流通道选路**：侧边栏独立下拉切换当前图像视口绑定的视频流，自动发现已发布的流通道（如 `camera_feed`、`sentry_hud` 等）。
  - **纯净真机图传呈现**：辅助图层、自瞄准星与目标标注由下位机 SDK 或算法节点在图像发布端直接生成与叠加，前端杜绝任何伪造的预设图层；彻底移除缩放平移及快速倍率等冗余按键，侧边栏保持极度聚焦与清爽。
  - **图传流诊断状态**：实时监控活动流通道名称与数据接收状态（活跃传输中 / 等待数据帧）。
- **运行日志调试面板 (Log Console & Sidebar)**：
  - **4 级日志实时过滤与计数**：提供 `DEBUG`、`INFO`、`WARN`、`ERROR` 复选过滤，右上角附带各级别实时捕获数量角标与「全显 / 仅告警」快捷切换。
  - **关键词与正则表达式检索**：支持输入普通子串或完整 JavaScript 正则表达式，实时过滤日志流并动态展示匹配条数。
  - **终端显示偏好**：支持接收新日志时「自动贴底滚动」与「显示高精度时间戳」独立开关，提供 500 / 1000 / 2000 / 5000 行环形缓冲区容量调节。
  - **日志导出与一键清空**：支持一键将当前会话日志导出下载为带有 ISO 时间戳的 `.log` 文本文件，支持一键清空终端。
- **纯粹工业级无标签设计与无干扰视窗 (Clean Interface & Pure Canvas)**：
  - **视口标题栏极简化**：移除图像与日志视口卡片标题栏中的类型切换冗余下拉菜单（`[图像 ▾]`、`[日志 ▾]`），避免双重文字重复。
  - **图像视口画布边到边纯净渲染**：移除图像视口内部上方的冗余控制条与流选择下拉菜单（`camera_feed ▾`），视口画布 100% 满屏呈现下位机回传的真实画面。
  - **彻底移除状态占位标签**：视口卡片标题栏、侧边栏标题与全局底部状态栏中均无「已开发」、「开发中」等冗余标签，界面保持高度纯净、严肃克制的生产级工业调试风格。
- **全局底部状态栏 (Workbench Status Bar)**：
  - 实时反映当前聚焦视口类型（曲线绘图 / 3D 空间视口 / 实时图像 / 运行日志）、关键数据流吞吐指标与分屏拓扑。

### 2. ROS 2 兼容高性能 3D 空间可视化 (High-Performance 3D Viewport)
- **标准 RViz2 体验**：基于 Three.js 实现右手 Z-Up 工业级 3D 坐标系，内置暗色网格与三轴立体指示箭头。
- **就地属性更新与共享几何体池 (In-place Mutation & Shared Geometries)**：彻底根除每帧销毁与重建 WebGL Mesh 的性能黑洞。对于同类型 Marker，复用已有 Mesh 并仅更新位姿矩阵（`position`/`quaternion`/`scale`）与材质颜色；共享预分配的单例几何体池（Box、Sphere、Cylinder），内存与 GPU 缓冲区分配降低 98% 以上。
- **数据流与 React DOM 解耦 & 节流汇报**：高频 UDP/SSE 数据直接在 WebGL 原生 `requestAnimationFrame` 循环中高效消费与渲染，图元元数据统计采用 5Hz 节流汇报，彻底切断高频数据对 React DOM 树的频繁重绘惩罚，持续稳定满帧 **60 FPS**。
- **纯净无遮挡视窗**：控制逻辑集中于左侧边栏，画布仅保留轻量化标记计数与轴向图例，最大化 3D 观察空间。
- **支持 10 种标准 ROS 2 Marker 图元**：
  - 基础几何：`ARROW` (箭头), `CUBE` (立方体), `SPHERE` (球体), `CYLINDER` (圆柱体)。
  - 连续轨迹与线条：`LINE_STRIP` (连续折线/轨迹曲线), `LINE_LIST` (成对射线/激光束)。
  - 列表与体素点云：`CUBE_LIST` (三维体素网格), `SPHERE_LIST` (多球环), `POINTS` (激光点云)。
  - 文字与表面：`TEXT_VIEW_FACING` (相机面向文本标签), `TRIANGLE_LIST` (多边形表面)。

### 3. 实时多通道示波器 (Telemetry Oscilloscope)
- 以最高 200Hz 频率实时采样并绘制多通道浮点波形（目标角度、实际追踪、误差、速度、电流、功率等）。
- 具备严格的历史窗口截断与自动滚动机制，杜绝长跑内存膨胀。
- 支持前端自定义派生函数公式（如求导、比例变换）。

### 4. 虚拟化结构化日志控制台 (Log Console)
- 实时推送带时间戳与色彩高亮的分级日志（`DEBUG`, `INFO`, `WARN`, `ERROR`）。
- 具备自动滚动、快速过滤与 2000 行环形缓冲区保护。

### 5. 视觉相机推流与内参标定 (Vision & Calibration)
- 实时 JPEG 压缩图传，毫秒级网络回传机器人相机第一视角。
- 支持平视显示准星（HUD）、目标包围盒与角点自动提取的单目相机内参标定。

### 6. 非侵入式 SWD 变量监视与热整定 (SWD Hardware Probe)
- 基于 OpenOCD Telnet 通讯，无需 halt CPU 即可在 MCU 运行时以 20~50Hz 周期读取/写入全局变量与结构体内存快照。

### 7. 会话录放与离线转码 (.rlog RMBag Replay & Dump)
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
