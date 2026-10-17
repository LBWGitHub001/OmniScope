# OmniScope — 全能机器人与嵌入式集成调试平台

**OmniScope** 是一套面向现代机器人研发、控制算法与嵌入式系统的全栈集成调试解决方案。它将**下位机高频遥测 SDK**、**满帧率视觉/姿态录放**、**非侵入式 SWD 硬件变量监视**与**现代化上位机调试门户**合为一体。

---

## 架构体系

工程清晰划分为**下位机（SDK）**与**上位机（Host）**两大体系：

```
OmniScope/
├── sdk/                        # 【下位机部分】附属在嵌入式/机器人代码中的 C++ & MCU SDK
│   ├── CMakeLists.txt          # 统一 CMake 导出 (OmniScope::All, Logger, RMBag, MCU)
│   ├── README.md               # 下位机快速上手与模块指南
│   ├── core/                   # 核心基础定义与通用工具 (OmniScope::Core)
│   ├── mcu/                    # 单片机 SWD 参数在线热整定与原子快照纯 C 头文件 (OmniScope::MCU)
│   ├── logger/                 # 远程遥测与日志核心 (OmniScope::Logger)
│   │   ├── include/            # 对外暴露公共头文件 (<omniscope/remote_logger.hpp>)
│   │   └── src/                # UDP 发送、分片图像压缩、异步 .rlog 落盘 (私有 internal/)
│   └── rmbag/                  # 满帧率无损视觉/云台姿态数据集录放库 (OmniScope::RMBag)
│       ├── include/            # 对外暴露公共头文件 (<omniscope/rmbag/*.hpp>)
│       └── src/                # 异步写入器与假设备回放源
│
├── host/                       # 【上位机部分】统一集成调试门户 (Python + React)
│   ├── start.sh                # 门户启动入口
│   ├── _env.sh                 # 自动 Python 环境管理
│   ├── requirements.txt        # Python 依赖
│   ├── rdbg/                   # Python 核心后端
│   │   ├── apps/               # Hub 服务门户 (hub_app.py)
│   │   ├── features/           # 可插拔功能模块 (watch, swd, replay, dump, calibrate, netcheck)
│   │   ├── swd/                # OpenOCD SWD telnet 客户端与 ELF nm 符号解析
│   │   ├── net/                # UDP 网络通讯栈 (发现、组播、队首中继)
│   │   ├── log/                # .rlog (RLG2) 编解码与 dump 转码器
│   │   └── static_ui/          # 前端单页应用 (SPA) 构建产物
│   └── ui/                     # 统一前端源码 (Vite + React 18 + TypeScript)
│       └── src/features/       # 前端功能面板 (watch, swd, replay, dump, netcheck)
│
├── start.sh                    # 根目录便捷启动入口
├── legacy_backup.tar.gz        # 原散落旧文件归档备份
└── .gitignore                  # Git 规范配置
```

---

## 快速上手

### 1. 启动上位机调试门户

确保本机安装了 Python 3.9+ 与 Node.js（如果需重新构建前端）：

```bash
./start.sh
# 浏览器自动打开 http://127.0.0.1:8080
```

上位机支持的功能包括：
- **SWD Monitor**：通过 OpenOCD Telnet（4444 端口）周期读取 MCU 内存中已有的全局变量（如 PID、传感器数值），无需 halt CPU，提供实时数值卡片与波形绘制。
- **Watch**：局域网发现车辆，单播接收下位机 RemoteLogger 发送的实时变量曲线、带等级日志与 JPEG 图像流。
- **Calibrate**：棋盘格相机内参在线标定。
- **Replay**：加载与回放下位机录制的 `.rlog` 文件，支持时间轴拖拽与多图多通道查看。
- **Dump**：离线将 `.rlog` 快速解包导出为 `log.txt`、`plot.txt` 与 `images.mp4` 视频。
- **Netcheck**：局域网 UDP 连通性、echo 与延迟诊断工具。

---

### 2. 下位机集成到机器人工程

在机器人 C++ 工程的 `CMakeLists.txt` 中添加：

```cmake
add_subdirectory(sdk)
# 一键链接全部 OmniScope 组件，或按需链接 OmniScope::Logger / OmniScope::RMBag
target_link_libraries(your_robot_target PRIVATE OmniScope::All)
```

代码中调用：

```cpp
#include <omniscope/remote_logger.hpp>

// 1. 初始化遥测引擎
omniscope::RemoteLogger::instance().init(config);

// 2. 实时打印曲线与变量 (Host Watch 面板可实时查看)
omniscope::RemoteLogger::instance().plot({
    {"yaw", current_yaw},
    {"pitch", current_pitch},
    {"speed", current_speed}
});

// 3. 实时输出日志
omniscope::RemoteLogger::instance().log("INFO", "Robot initialized successfully");

// 4. 实时图像回传与本地异步压缩保存
omniscope::RemoteLogger::instance().plot_image(mat_bgr, {{"name", "raw"}});
```

---

### 3. 构建与改动前端

修改 `host/ui/src/` 代码后，构建静态产物：

```bash
./host/ui/build.sh
```

产物将自动写入 `host/rdbg/static_ui/`。

---

## 命令行小工具

除统一网页门户之外，也可通过命令行直接执行特定功能：

```bash
# 启动统一门户
python3 -m rdbg serve

# 离线导出 .rlog 为文本与 MP4 视频
python3 -m rdbg dump path/to/session.rlog -o ./export_dir/

# 运行网络发现诊断
python3 ./host/netcheck.py discover
```
