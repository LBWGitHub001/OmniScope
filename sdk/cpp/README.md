# OmniScope C++ SDK 文档（`OmniScope::Cpp`）

面向机器人车载工控机（Linux / ROS / Jetson）与控制算法工程的高频遥测调试客户端。
提供示波器波形遥测、结构化分级日志、ROS 2 兼容 3D Marker、实时图像推流、上位机反向控制、`.rmbag` 数据集录放与相机标定。

- 嵌入式 / 单片机固件请见：[`../embedded/README.md`](../embedded/README.md)
- 双版本对比与 CMake 引入总览请见：[`../README.md`](../README.md)

**目录**

- [1. 核心组件](#1-核心组件)
- [2. 核心功能](#2-核心功能)
- [3. API 参考](#3-api-参考)
  - [3.1 生命周期与配置](#31-生命周期与配置)
  - [3.2 遥测波形 plot](#32-遥测波形-plot)
  - [3.3 分级日志 log / info / warn / error / debug](#33-分级日志-log--info--warn--error--debug)
  - [3.4 3D 标记 Marker 与 plot_marker](#34-3d-标记-marker-与-plot_marker)
  - [3.5 图像推流 plot_image](#35-图像推流-plot_image)
  - [3.6 反向控制 poll_json / poll_calib_cmd](#36-反向控制-poll_json--poll_calib_cmd)
  - [3.7 rmbag 数据集录放](#37-rmbag-数据集录放)
  - [3.8 标定模块 calibration](#38-标定模块-calibration)
- [4. 综合示例（一段代码覆盖全部 API）](#4-综合示例一段代码覆盖全部-api)
- [5. 依赖与 CMake 集成](#5-依赖与-cmake-集成)

---

## 1. 核心组件

### 1.1 `RemoteLogger` — 单例遥测引擎

所有 C++ 能力的核心。`RemoteLogger::instance()` 全局单例，`omniscope::` 命名空间下的自由函数（`plot` / `info` / `plot_marker` / …）均为它的零开销转发。

内部数据通路：

| 调用 | 通路 |
|---|---|
| `plot` / `log` | 本地异步 `.rlog` 落盘 + 局域网 UDP 单播（队首中继） |
| `plot_image` | 自动限频/丢帧入选 → JPEG 压缩 → 本地 `.rlog`；仅当 Host 订阅时 UDP 分片发送 |
| `init(enable_remote=true)` | 自动 Beacon 广播（`beacon_port`，默认 15999），Host 门户自动发现本节点 |

### 1.2 `Marker` — ROS 2 兼容 3D 标记体系

与 `visualization_msgs/msg/Marker` 对齐的 11 种图元，配套 Fluent 静态工厂（`Marker::make_arrow(...)` 等）与链式 setter（`.set_ns(...).set_id(...)`），序列化为 JSON 后经 `RemoteLogger` 上报，前端 Three.js 视口就地更新渲染。

### 1.3 `rmbag` — 视觉姿态数据集录放

高性能二进制会话记录格式 `RMB1`：每帧包含 72 字节定长帧头（纳秒时间戳 + 四元数 + 欧拉角 + 模式字 + 图像描述）与原始像素载荷。提供 `Writer`（录制）、`Reader`（顺序读取）、`Playback`（硬件在环定时回放）三件套。

### 1.4 标定模块 `calibration`

棋盘格单目相机内参标定：算法（`calibrator.cpp`）+ 独立节点 `omniscope_calibrate` + 无硬件仿真数据源 `TestFeed`。仅在找到 `Eigen3` + `yaml-cpp` + `nlohmann_json` 时编入（见 [5. 依赖与 CMake 集成](#5-依赖与-cmake-集成)）。

---

## 2. 核心功能

1. **遥测波形**：`plot({{"yaw", 12.5}, ...})` 一行上报多通道浮点曲线，前端示波器最高 200Hz。
2. **结构化日志**：`DEBUG / INFO / WARN / ERROR` 四级，支持 `fmt` 占位符格式化，前端虚拟化控制台实时过滤检索。
3. **3D 空间标记**：箭头、立方体、轨迹折线、点云、面向相机文本等 11 种图元，前端 60 FPS 就地更新。
4. **图像推流**：`cv::Mat` 直接上报，自动限频 + JPEG 压缩，支持 HUD 元数据注入。
5. **反向控制**：`poll_json` 轮询 Host 网页下发的 JSON 命令，实现上位机遥控下位机。
6. **数据集录放**：`.rmbag` 纳秒对齐录制、顺序读取与定时回放（硬件在环）。
7. **相机标定**：棋盘格角点提取 + 内参解算，Host 网页下达标定指令（`poll_calib_cmd`）。

---

## 3. API 参考

约定：所有 API 位于命名空间 `omniscope`；统揽头文件为

```cpp
#include <omniscope/omniscope.hpp>
```

该头依次包含 `logger.hpp`（`Logger = RemoteLogger` 兼容别名）、`remote_logger.hpp`、`marker.hpp`。

### 3.1 生命周期与配置

---

#### `omniscope::init`

```cpp
void omniscope::init(const RemoteLogger::Config & cfg);
void omniscope::init(const std::string & config_path);   // YAML 配置文件
```

初始化遥测引擎。程序启动时调用一次，之后才能使用 `plot` / `log` 等全部上报 API。

**Parameters**

- `cfg` (`RemoteLogger::Config`) — 结构体配置，字段见下表。
- `config_path` (`std::string`) — YAML 文件路径，读取其中 `remote_logger:` 节点的同名键（键缺失时保留默认值）。

**`RemoteLogger::Config` 字段**

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `control_port` | `uint16_t` | `15000` | Host 控制连接端口 |
| `beacon_port` | `uint16_t` | `15999` | UDP Beacon 广播端口（Host 自动发现监听口） |
| `enable_remote` | `bool` | `true` | 启用局域网远程上报（Beacon + UDP） |
| `enable_local` | `bool` | `true` | 启用本地 `.rlog` 异步落盘 |
| `log_dir` | `std::string` | `"./logs"` | 本地日志目录 |
| `var_buffer_size` | `size_t` | `1024` | 变量（波形/日志）异步队列长度 |
| `img_buffer_size` | `size_t` | `10` | 图像帧异步队列长度 |
| `img_width` | `int` | `640` | 图像推流缩放宽度（等比） |
| `img_quality` | `int` | `50` | JPEG 压缩质量（0~100） |
| `heartbeat_interval_ms` | `uint32_t` | `0` | 心跳间隔（0 = 关闭） |
| `sender_name` | `std::string` | `""` | 节点身份名，Host 车辆卡片显示名 |
| `app` | `std::string` | `"normal"` | Beacon 身份：`normal` 普通调试 / `calibrate` 标定程序（Host 据此开对应页面） |
| `beacon_interval_ms` | `uint32_t` | `1000` | Beacon 广播周期 |
| `head_timeout_ms` | `uint32_t` | `2000` | 队首中继超时 |

**YAML 配置示例**（与 `Config` 字段同名）：

```yaml
remote_logger:
  sender_name: "sentry_robot"
  control_port: 15000
  beacon_port: 15999
  enable_remote: true
  enable_local: true
  log_dir: "./logs"
  img_width: 640
  img_quality: 50
  beacon_interval_ms: 1000
  head_timeout_ms: 2000
```

**Example**

```cpp
omniscope::RemoteLogger::Config cfg;
cfg.sender_name = "sentry_robot";
cfg.control_port = 15000;
omniscope::init(cfg);
```

---

#### `omniscope::shutdown`

```cpp
void omniscope::shutdown();
```

优雅关闭遥测引擎：刷新本地落盘与后台发送队列。程序退出前调用。

---

#### `RemoteLogger::instance`

```cpp
static RemoteLogger & RemoteLogger::instance();
```

取全局单例。需要直接调用未在 `omniscope::` 自由函数中暴露的方法（如 `poll_calib_cmd`）时使用。

### 3.2 遥测波形 plot

---

#### `omniscope::plot`

```cpp
void omniscope::plot(const nlohmann::json & data);
```

极简高频遥测上报：一个 JSON 对象的键为通道名、值为数值，前端示波器按通道分色绘制。调用频率建议 ≤ 200Hz。

**Parameters**

- `data` (`nlohmann::json`) — `{{"通道名", 值}, ...}`，值为数值类型。

**Example**

```cpp
omniscope::plot({{"yaw", 12.5}, {"pitch", -3.2}, {"speed", 28.0}});
```

#### 通用 XY 曲线发布（频域发布）

`plot` 消息中，任何值为对象且含 `x` / `y` 两个**等长数值数组**的键，Watch 前端将其渲染为一条 XY 曲线，**键名即通道名**。频域发布（FFT 频谱）是其典型用法，也可用于相平面图、标定曲线、直方图等任意 XY 数据。无需新增 API，直接复用 `omniscope::plot`：

```cpp
// 示例：发布一通道 FFT 频谱（FFT 由调用方计算）
nlohmann::json msg;
msg["obs_x_spectrum"] = {
    {"x", freq},   // 频率轴 (Hz)
    {"y", mag},    // 幅度
    {"meta", {{"xlabel", "Hz"}, {"kind", "spectrum"}, {"fs", sample_rate}}}  // 可选展示提示
};
omniscope::plot(msg);
```

- `meta` 可选：`xlabel` 为 x 轴单位标签；`kind="spectrum"` 提示前端按频谱展示（默认开启 dB 纵轴与最高峰标注）
- 数字值照旧进入时域曲线，与 XY 曲线互不干扰
- Watch 页将面板类型切换为「XY 曲线」即可选择对应通道查看

### 3.3 分级日志 log / info / warn / error / debug

---

#### `omniscope::log`

```cpp
void omniscope::log(const std::string & level, const std::string & msg);
template <typename... Args>
void omniscope::log(const std::string & level, const std::string & fmt_str, Args &&... args);
```

发送分级日志。模板重载使用 `fmt` 占位符格式化（`fmt::runtime`，运行时检查格式串）。

**Parameters**

- `level` (`std::string`) — `"DEBUG"` / `"INFO"` / `"WARN"` / `"ERROR"`。
- `msg` (`std::string`) — 已拼好的日志文本。
- `fmt_str` (`std::string`) — `fmt` 格式串，如 `"dist={:.2f}m"`。
- `args` — 格式参数。

---

#### `omniscope::info / warn / error / debug`

```cpp
template <typename... Args>
void omniscope::info(const std::string & fmt_str, Args &&... args);
// warn / error / debug 签名相同
```

对应级别的 `log` 便捷包装。

**Example**

```cpp
omniscope::info("Target acquired: dist={:.2f}m", 2.34);
omniscope::warn("Gimbal limit approaching: {:.1f}deg", 48.5);
omniscope::error("Camera offline, code={}", 1007);
```

### 3.4 3D 标记 Marker 与 plot_marker

---

#### `omniscope::plot_marker / plot_markers`

```cpp
void omniscope::plot_marker(const Marker & marker);
void omniscope::plot_markers(const std::vector<Marker> & markers);
```

上报单个 / 批量 3D Marker。同一 `ns:id` 重复上报为就地更新；`lifetime` 到期自动消失。

---

#### `struct Marker`

ROS 2 `visualization_msgs/msg/Marker` 对齐结构。

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `frame_id` | `std::string` | `"base_link"` | 所在坐标系 |
| `ns` | `std::string` | `"default"` | 命名空间（与 `id` 共同唯一标识） |
| `id` | `int32_t` | `0` | 标记 ID |
| `type` | `MarkerType` | `CUBE` | 图元类型 |
| `action` | `MarkerAction` | `ADD` | 动作 |
| `pose` | `Pose` | 原点 + 单位四元数 | 位姿（`Vector3 position` + `Quaternion orientation`） |
| `scale` | `Vector3` | `{1,1,1}` | 尺寸（含义随类型而异，见各工厂） |
| `color` | `ColorRGBA` | `{0, 0.94, 1, 1}` | RGBA，默认赛博青 |
| `lifetime` | `float` | `0` | 存活秒数，0 = 永不过期 |
| `frame_locked` | `bool` | `false` | 是否锁定于坐标系 |
| `points` | `std::vector<Vector3>` | 空 | 点集（线条/点云/箭头起止点等） |
| `colors` | `std::vector<ColorRGBA>` | 空 | 逐点颜色（可选） |
| `text` | `std::string` | 空 | 文本（`TEXT_VIEW_FACING`） |

辅助结构：`Vector3{x,y,z}`、`Quaternion{x,y,z,w=1}`、`Pose{position,orientation}`、`ColorRGBA{r,g,b,a=1}`，均带 nlohmann 侵入式序列化；`Marker::to_json() / from_json()` 可手动转换。

---

#### `omniscope::plot_tf / plot_tfs`

```cpp
void omniscope::plot_tf(const TransformStamped & tf);
void omniscope::plot_tfs(const std::vector<TransformStamped> & tfs);
```

上报 parent → child 变换。Host 用 TF 树把 Marker 的 `frame_id` 变到当前查看坐标系。

`TransformStamped`：`parent`（默认 `"world"`）、`child`、`translation`、`rotation`（`x,y,z,w`）。

---

#### `enum class MarkerType`

| 值 | 枚举 | 用途 |
|---|---|---|
| 0 | `ARROW` | 3D 箭头（`points` = 起点、终点） |
| 1 | `CUBE` | 立方体 / 包围盒 |
| 2 | `SPHERE` | 球体 / 路标 |
| 3 | `CYLINDER` | 圆柱体 |
| 4 | `LINE_STRIP` | 连续折线 / 轨迹 |
| 5 | `LINE_LIST` | 成对离散线段 / 射线 |
| 6 | `CUBE_LIST` | 批量立方体 / 体素栅格（需手工构造，无 `make_*`） |
| 7 | `SPHERE_LIST` | 批量球体（需手工构造，无 `make_*`） |
| 8 | `POINTS` | 点云集合 |
| 9 | `TEXT_VIEW_FACING` | 始终面向相机的文本标签 |
| 11 | `TRIANGLE_LIST` | 三角网格面片 |

#### `enum class MarkerAction`

| 值 | 枚举 | 含义 |
|---|---|---|
| 0 | `ADD` / `MODIFY` | 新增或更新 `ns:id` |
| 2 | `DELETE` | 删除指定 `ns:id` |
| 3 | `DELETEALL` | 清空全部标记 |

---

#### `Marker::make_*` 静态工厂（Fluent Builder）

全部返回 `Marker &` 可继续链式调用 `set_ns / set_id / set_frame / set_lifetime`。

```cpp
static Marker Marker::make_arrow(const Vector3 & start, const Vector3 & end,
                                 const ColorRGBA & col = {0, 0.94, 1, 1},
                                 float shaft_dia = 0.05f, float head_dia = 0.1f);
static Marker Marker::make_cube(const Vector3 & center,
                                const Vector3 & size = {0.2f, 0.2f, 0.2f},
                                const ColorRGBA & col = {0, 0.94f, 1, 1});
static Marker Marker::make_sphere(const Vector3 & center, float radius = 0.1f,
                                  const ColorRGBA & col = {...});
static Marker Marker::make_cylinder(const Vector3 & center, float radius = 0.1f,
                                    float height = 0.4f, const ColorRGBA & col = {...});
static Marker Marker::make_line_strip(const std::vector<Vector3> & pts,
                                      const ColorRGBA & col = {...}, float width = 0.03f);
static Marker Marker::make_line_list(const std::vector<Vector3> & pairs,
                                     const ColorRGBA & col = {...}, float width = 0.03f);
static Marker Marker::make_points(const std::vector<Vector3> & pts,
                                  const ColorRGBA & col = {...}, float size = 0.05f);
static Marker Marker::make_text(const Vector3 & pos, const std::string & str,
                                const ColorRGBA & col = {1, 1, 1, 1}, float size = 0.2f);
static Marker Marker::make_triangle_list(const std::vector<Vector3> & vertices,
                                         const ColorRGBA & col = {...});
static Marker Marker::make_delete(const std::string & del_ns, int32_t del_id);
static Marker Marker::make_delete_all();
```

**Parameters（共有）**

- `col` (`ColorRGBA`) — 颜色；`line_strip/line_list` 的 `width`、`points` 的 `size` 为线宽/点径（米）。
- `ARROW`：`points={start,end}`，`scale={shaft_dia, head_dia, 0}`。
- `CUBE_LIST` / `SPHERE_LIST`：手工置 `type`、填 `points`（逐点颜色填 `colors`），`scale` 为单体尺寸。

**链式 setter**：`set_ns(std::string)` / `set_id(int32_t)` / `set_frame(std::string)` / `set_lifetime(float)`，均返回 `Marker &`。

**Example**

```cpp
auto arrow = omniscope::Marker::make_arrow({0, 0, 0.3f}, {2.0f, 1.0f, 0.5f})
                 .set_ns("gimbal").set_id(1).set_lifetime(0.5f);
omniscope::plot_marker(arrow);
omniscope::plot_marker(omniscope::Marker::make_delete("gimbal", 1));
```

### 3.5 图像推流 plot_image

---

#### `omniscope::plot_image`

```cpp
void omniscope::plot_image(const cv::Mat & img, const nlohmann::json & meta = {});
```

上报一帧图像：自动限频与丢帧入选 → 缩放至 `img_width` 宽 → JPEG（`img_quality`）压缩 → 本地 `.rlog`；Host 订阅时 UDP 分片实时发送。

**Parameters**

- `img` (`cv::Mat`) — BGR 图像（OpenCV 默认通道序）。
- `meta` (`nlohmann::json`) — 元数据；`{"name": "流通道名"}` 指定前端视频流通道（如 `camera_feed`、`sentry_hud`）。

**Example**

```cpp
cv::Mat frame = cv::imread("frame.jpg");
omniscope::plot_image(frame, {{"name", "sentry_hud"}});
```

### 3.6 反向控制 poll_json / poll_calib_cmd

---

#### `omniscope::poll_json`

```cpp
bool omniscope::poll_json(nlohmann::json & data);
```

非阻塞轮询 Host 网页下发的通用 JSON 控制命令。

**Returns** — `true` 表示取到一条命令并写入 `data`；`false` 表示队列为空。

---

#### `RemoteLogger::poll_calib_cmd`

```cpp
bool RemoteLogger::poll_calib_cmd(std::string & cmd);
```

非阻塞轮询 Host 标定页下发的标定指令（如开始/采集/解算）。经 `omniscope::RemoteLogger::instance().poll_calib_cmd(cmd)` 调用，标定节点（`app="calibrate"`）专用。

### 3.7 rmbag 数据集录放

头文件：`<omniscope/rmbag/writer.hpp>` / `reader.hpp` / `playback.hpp` / `proto.hpp` / `meta.hpp`，命名空间 `omniscope::rmbag`。

**二进制协议（`RMB1`）**：文件以 magic `0x31424D52`（`"RMB1"`）开头，随后 JSON header、若干帧记录（类型 `0x01`）、JSON footer（类型 `0x03`）。每帧帧头 `FrameHeader` 为 72 字节定长（`#pragma pack(1)`，`static_assert` 锁定）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `ts_ns` | `uint64_t` | 纳秒时间戳 |
| `q_w/q_x/q_y/q_z` | `double` × 4 | 姿态四元数 |
| `yaw_deg/pitch_deg/roll_deg` | `float` × 3 | 欧拉角（度） |
| `mode` | `uint8_t` | 模式字 |
| `width/height/step` | `uint32_t` × 3 | 图像宽/高/行字节数 |
| `data_len` | `uint32_t` | 像素载荷字节数 |

帧数据载体：`struct Frame { FrameHeader hdr; std::vector<uint8_t> pixels; }`。

---

#### `rmbag::Writer`

```cpp
bool   open(const std::string & path);
bool   write_header(const nlohmann::json & header);
bool   write_frame(const Frame & frame);
bool   write_footer(const nlohmann::json & footer);
void   close();
const std::string & path() const;
uint64_t bytes_written() const;
uint64_t frame_count() const;
```

录制会话数据集。典型顺序：`open` → `write_header`（可用 `collect_session_header` 生成）→ 逐帧 `write_frame` → `write_footer` → `close`。返回 `false` 表示写入失败。

---

#### `rmbag::Reader`

```cpp
bool open(const std::string & path);
void close();
bool rewind();
const nlohmann::json & header() const;
const std::optional<nlohmann::json> & footer() const;
bool read_frame(Frame & out);
const std::string & path() const;
```

顺序读取。`read_frame` 返回 `false` 表示 EOF（footer 已消费或文件截断）；`rewind` 回到数据区起点重读。

---

#### `rmbag::Playback`

```cpp
static std::shared_ptr<Playback> acquire(const std::string & path, bool loop, bool realtime);
bool next();
bool has_frame() const;
Frame current() const;
const nlohmann::json & header() const;
bool loop() const;
bool realtime() const;
const std::string & path() const;
std::chrono::steady_clock::time_point stamp() const;
```

硬件在环定时回放：Camera 线程推进帧（`next`），Gimbal 线程读取当前姿态（`current`）。`realtime=true` 时按帧间纳秒时间戳真实 sleep 对齐；`loop=true` 到末尾自动回卷。`acquire` 为带缓存的工厂（同路径复用实例）。

---

#### `rmbag::collect_session_header`

```cpp
nlohmann::json rmbag::collect_session_header(
    const std::string & config_path, int argc, char ** argv,
    const std::string & device_name);
```

采集会话元信息（配置、命令行、设备名）生成数据集 header JSON。

### 3.8 标定模块 calibration

头文件：`<omniscope/calibration/test_feed.hpp>`，命名空间 `calibration`。仅在 `Eigen3 + yaml-cpp + nlohmann_json` 齐备时编入，同时生成独立节点可执行文件 `omniscope_calibrate`。

---

#### `calibration::make_chessboard`

```cpp
cv::Mat calibration::make_chessboard(cv::Size pattern, int square_px, int margin);
```

生成棋盘格标定板图像。`pattern` 为内角点数（如 `{11, 8}`），`square_px` 单格像素边长，`margin` 白边像素。

---

#### `calibration::TestFeed`

```cpp
explicit TestFeed(cv::Size pattern = {11, 8}, cv::Size frame = {640, 480});
void read(cv::Mat & img, std::chrono::steady_clock::time_point & timestamp);
cv::Mat next_frame();
```

无硬件仿真数据源：周期性平移/缩放/轻透视棋盘格视频流，用于标定流程自测（`app="calibrate"` 时 Host 开标定页）。

---

## 4. 综合示例（一段代码覆盖全部 API）

```cpp
// omni_demo.cpp — OmniScope C++ SDK 全 API 演示
#include <omniscope/omniscope.hpp>            // init/plot/log/marker/image/poll_json
#include <omniscope/rmbag/writer.hpp>         // 数据集录制
#include <omniscope/rmbag/reader.hpp>         // 数据集读取
#include <omniscope/rmbag/playback.hpp>       // 定时回放
#include <omniscope/rmbag/meta.hpp>           // 会话元信息
#include <omniscope/calibration/test_feed.hpp>// 标定仿真源
#include <opencv2/imgcodecs.hpp>
#include <thread>
#include <chrono>

int main(int argc, char ** argv)
{
    // ============ 1. 生命周期与配置 ============
    omniscope::RemoteLogger::Config cfg;
    cfg.sender_name = "demo_robot";
    cfg.control_port = 15000;
    cfg.img_width = 640;
    cfg.img_quality = 50;
    omniscope::init(cfg);
    // 或者走 YAML 文件: omniscope::init("./omniscope.yaml");

    // ============ 2. 遥测波形 ============
    omniscope::plot({{"yaw", 12.5}, {"pitch", -3.2}, {"speed", 28.0}});

    // ============ 3. 分级日志 ============
    omniscope::log("INFO", "plain message");
    omniscope::debug("boot sequence {}", 3);
    omniscope::info("Target acquired: dist={:.2f}m", 2.34);
    omniscope::warn("Gimbal limit approaching: {:.1f}deg", 48.5);
    omniscope::error("Camera offline, code={}", 1007);

    // ============ 4. 3D 标记（11 种图元全覆盖） ============
    using omniscope::Marker;
    using omniscope::Vector3;
    omniscope::ColorRGBA red{1.0f, 0.2f, 0.2f, 1.0f};

    omniscope::plot_marker(Marker::make_arrow({0, 0, 0.3f}, {2.0f, 1.0f, 0.5f})
                               .set_ns("demo").set_id(0));
    omniscope::plot_marker(Marker::make_cube({1, 0, 0.1f}, {0.4f, 0.4f, 0.2f}, red)
                               .set_ns("demo").set_id(1));
    omniscope::plot_marker(Marker::make_sphere({0, 1, 0.1f}, 0.15f)
                               .set_ns("demo").set_id(2));
    omniscope::plot_marker(Marker::make_cylinder({0, 0, 0.4f}, 0.05f, 0.8f)
                               .set_ns("demo").set_id(3));
    omniscope::plot_marker(Marker::make_line_strip({{0, 0, 0}, {1, 0, 0}, {1, 1, 0.2f}})
                               .set_ns("demo").set_id(4).set_lifetime(5.0f));
    omniscope::plot_marker(Marker::make_line_list({{0, 0, 0}, {2, 0, 0},
                                                   {0, 0, 0}, {0, 2, 0}})
                               .set_ns("demo").set_id(5));
    omniscope::plot_marker(Marker::make_points({{0, 0, 0}, {0.5f, 0.5f, 0.3f}}, red, 0.05f)
                               .set_ns("demo").set_id(6));
    omniscope::plot_marker(Marker::make_text({0, 0, 1.0f}, "SENTRY LOCKED")
                               .set_ns("demo").set_id(7));
    omniscope::plot_marker(Marker::make_triangle_list({{0, 0, 0}, {1, 0, 0}, {0.5f, 1, 0}})
                               .set_ns("demo").set_id(8));

    // CUBE_LIST / SPHERE_LIST 无工厂, 手工构造:
    Marker voxels;
    voxels.type = omniscope::MarkerType::CUBE_LIST;
    voxels.ns = "demo"; voxels.id = 9;
    voxels.scale = {0.1f, 0.1f, 0.1f};
    voxels.points = {{0, 0, 0}, {0.2f, 0, 0}, {0, 0.2f, 0}};
    omniscope::plot_marker(voxels);

    // 批量上报 + 删除
    omniscope::plot_markers({Marker::make_sphere({2, 2, 0.1f}).set_ns("batch").set_id(0),
                             Marker::make_cube({3, 2, 0.1f}).set_ns("batch").set_id(1)});
    omniscope::plot_marker(Marker::make_delete("batch", 1));
    omniscope::plot_marker(Marker::make_delete_all());

    // ============ 5. 图像推流 ============
    cv::Mat frame = cv::imread("frame.jpg");
    if (!frame.empty()) {
        omniscope::plot_image(frame, {{"name", "demo_camera"}});
    }

    // ============ 6. 反向控制命令 ============
    nlohmann::json cmd;
    if (omniscope::poll_json(cmd)) {
        omniscope::info("Host command: {}", cmd.dump());
    }
    std::string calib_cmd;
    if (omniscope::RemoteLogger::instance().poll_calib_cmd(calib_cmd)) {
        omniscope::info("Calib command: {}", calib_cmd);
    }

    // ============ 7. rmbag 数据集录制 ============
    {
        omniscope::rmbag::Writer writer;
        writer.open("./session.rmbag");
        writer.write_header(
            omniscope::rmbag::collect_session_header("./cfg.yaml", argc, argv, "demo_robot"));

        omniscope::rmbag::Frame f;
        f.hdr.ts_ns = 1729000000000000000ULL;
        f.hdr.q_w = 1.0; f.hdr.q_x = 0.0; f.hdr.q_y = 0.0; f.hdr.q_z = 0.0;
        f.hdr.yaw_deg = 12.5f; f.hdr.pitch_deg = -3.2f; f.hdr.roll_deg = 0.0f;
        f.hdr.mode = 1;
        f.hdr.width = 2; f.hdr.height = 2; f.hdr.step = 6;
        f.pixels = {0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255};   // 2x2 BGR
        f.hdr.data_len = (uint32_t)f.pixels.size();
        writer.write_frame(f);
        writer.write_footer({{"frames", writer.frame_count()}});
        writer.close();
    }

    // ============ 8. rmbag 顺序读取 ============
    {
        omniscope::rmbag::Reader reader;
        if (reader.open("./session.rmbag")) {
            omniscope::info("bag header: {}", reader.header().dump(2));
            omniscope::rmbag::Frame f;
            while (reader.read_frame(f)) {
                omniscope::info("frame ts={} px={}", f.hdr.ts_ns, f.pixels.size());
            }
        }
    }

    // ============ 9. rmbag 定时回放（硬件在环） ============
    {
        auto pb = omniscope::rmbag::Playback::acquire("./session.rmbag",
                                                      /*loop=*/true, /*realtime=*/true);
        while (pb->next()) {
            omniscope::rmbag::Frame f = pb->current();
            omniscope::info("replay yaw={:.1f}", f.hdr.yaw_deg);
            break;  // 演示只取一帧
        }
    }

    // ============ 10. 标定仿真数据源 ============
    {
        calibration::TestFeed feed({11, 8}, {640, 480});
        cv::Mat board_frame = feed.next_frame();          // 或 feed.read(img, timestamp);
        omniscope::plot_image(board_frame, {{"name", "calib_feed"}});
    }

    // ============ 11. 优雅关闭 ============
    omniscope::shutdown();
    return 0;
}
```

---

## 5. 依赖与 CMake 集成

**语言标准**：C++17（`target_compile_features(... cxx_std_17)`），静态库 + `POSITION_INDEPENDENT_CODE`。

**第三方依赖**（`find_package(OmniScope)` 或 `add_subdirectory` 时自动查找）：

| 依赖 | 必要性 | 用途 |
|---|---|---|
| Threads | 必需 | 后台发送/落盘线程 |
| OpenCV（core imgcodecs imgproc） | 必需 | 图像管线（calib3d / highgui 为可选组件） |
| fmt | 必需 | 日志格式化 |
| nlohmann_json | 可选（建议） | 全库 JSON 载体 |
| yaml-cpp | 可选 | `init(yaml路径)` 与标定 |
| Eigen3 | 可选 | 标定解算；三者齐备才编入标定模块并生成 `omniscope_calibrate` 节点 |

**方式 A：源码子目录**

```cmake
add_subdirectory(path/to/OmniScope/sdk)
target_link_libraries(your_robot_target PRIVATE OmniScope::Cpp)
```

**方式 B：安装后 `find_package`**

```bash
cmake -S sdk -B sdk/build && cmake --build sdk/build -j
cmake --install sdk/build --prefix /opt/omniscope
```

```cmake
find_package(OmniScope CONFIG REQUIRED)
target_link_libraries(your_target PRIVATE OmniScope::Cpp)
```

链接 `OmniScope::Cpp` 不会引入任何嵌入式版头文件；单片机固件请使用 [`OmniScope::Embedded`](../embedded/README.md)。
