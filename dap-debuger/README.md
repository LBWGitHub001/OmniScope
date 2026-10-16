# dap-debuger — OpenOCD SWD 符号监视器

在 CLion 用 CMSIS-DAP / OpenOCD 调试时，本工具经 **telnet `:4444`** 周期读取固件里**已经存在**的全局符号，与 GDB `:3333` 共用同一条 SWD。不 halt、不另起 OpenOCD、不要求额外烧录监视代码。

约定见 [watch_block.md](watch_block.md)：当前默认符号是 `radar` 工程里的 `aRGB`。

## 界面

```bash
cd /home/lbw/Project/RM2027/dap-debuger
./start.sh
```

浏览器打开 `http://127.0.0.1:8765`。先开这个页面，再在 CLion 点 Debug。左侧搜索 ELF 里已有的全局符号，加入监视后即可看到数值和曲线。

首次运行会安装并构建 `frontend/`。命令行监视仍然可用：

```bash
python3 watch_swd.py --auto --project ../radar --symbol aRGB
```

## 依赖

- Python 3.9+（仅标准库，见 `requirements.txt`）
- Node.js（仅首次构建 Vue 界面）
- 本机已有 OpenOCD（通常由 CLion Embedded 启动）
- 解析符号：`arm-none-eabi-nm`（或系统 `nm`）

## 日常用法（推荐）

先开界面，再在 CLion 点 Debug / Continue：

```bash
./start.sh
# 换默认符号：SYMBOL=foo ./start.sh
# 换工程：PROJECT=/path/to/fw ./start.sh
# 界面端口：UI_PORT=8765 ./start.sh
```

页面状态：

1. 顶栏为「等待调试」，直到 CLion 拉起 OpenOCD
2. 变为「实时监视」后，卡片上的数值和曲线开始更新
3. Stop Debug 后回到等待；再次 Debug 自动恢复

### 一次性连通性测试

```bash
python3 watch_swd.py --once --wait --project /path/to/firmware --symbol aRGB --frames 20
# 或固定地址（默认读 4 字节）：
python3 watch_swd.py --once --addr 0x20000000 --frames 20
```

### 常用参数

| 参数 | 含义 |
|------|------|
| `--auto` | 常驻（默认）：等待 / 重连 OpenOCD |
| `--once` | 单次会话后退出 |
| `--project DIR` | 在工程下选最新 `cmake-build*/**/*.elf` |
| `--elf PATH` | 显式 ELF |
| `--symbol NAME` | 已有全局符号，默认 `aRGB` |
| `--addr 0x...` | 跳过 nm（调试用，读 4 字节） |
| `--host` / `--port` | 默认 `127.0.0.1`；端口未指定时尝试从 `openocd` 命令行读 `telnet_port`，否则 `4444` |
| `--hz` | 目标采样率，默认 `20`（验证性能可试 `50`） |

## CLion 前置条件

Debug 控制台中应出现：

```text
Listening on port 4444 for telnet connections
```

若被关掉，在 OpenOCD 配置或启动参数中保留 `telnet_port 4444`（不要 `telnet_port disabled`）。

## 设计约束

1. **不拖主程序**：只发 `mdw`，拒绝 `halt` / `reset`；失败指数退避；按符号大小读，最多 64 字节。
2. **换板通用**：只换 `--project` / `--elf` 和约定符号名，不绑芯片基址。
3. **跟 CLion 自动听数**：`--auto` 在 Debug 前后自动等待与重连；ELF 更新后自动重新 `nm`。

## 验收清单

- [ ] 打开 `http://127.0.0.1:8765`，再点 CLion Debug，页面上 `aRGB` 的值在变
- [ ] Stop Debug 后回到 waiting；再 Debug 自动恢复
- [ ] Continue 时 CLion 断点 / 单步仍可用
- [ ] `--hz 50` 短测时主程序观感正常，失败主要出现在烧录 / 复位窗口

## 手动试通 telnet

```bash
nc localhost 4444
# 进入后（地址以 nm 为准）：
mdw 0x<符号地址> 1
```
