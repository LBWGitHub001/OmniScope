# 符号约定

监视器不要求固件额外烧一段 WatchBlock。协议只有一条：

**双方约定一个已经在固件里的全局符号名。** 主机用 `nm` 在 ELF 里查出地址和大小，再经 OpenOCD `mdw` 读这块 RAM。

## 当前约定

| 工程 | 符号 | 含义 |
|------|------|------|
| `radar` | `aRGB` | 灯效颜色，主循环里已在更新 |

换变量或换板：

```bash
SYMBOL=某个已有全局 ./start.sh
# 或
./start.sh --symbol 某个已有全局 --project /path/to/firmware
```

符号必须是链接进 ELF 的全局（`nm` 能看到），并且放在 DAP 能读到的 RAM 里。不要选只挂在 CPU 本地 TCM/CCM 上的变量。

## 主机读什么

- 地址、大小来自 `arm-none-eabi-nm -S`
- 按符号大小读，最多 64 字节
- 打印十六进制字；4 字节时附带 `u32=`
- 不要求 magic、seq 或固定结构体
