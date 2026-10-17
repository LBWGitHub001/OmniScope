# OmniScope MCU 嵌入式单片机 C 语言支持库

本目录包含面向嵌入式 MCU（STM32 / ESP32 / RP2040 / Cortex-M 系列）的纯 C 语言库与头文件，专为 **OmniScope SWD 非侵入式在线调试** 设计。

## 特性

- **纯 C 语言设计（C99/C11 兼容）**：提供 `mailbox.h` 头文件与 `mailbox.c` 实现文件，不依赖任何 C++ 特性或复杂运行库，单片机开箱即用；
- **零 CPU 暂停（Zero-Halt）**：完全基于 ARM Cortex-M DAP 硬件总线内存访问，无需打断点或停止控制主循环；
- **在线参数热整定（Live Tuning）**：提供 `omniscope_mailbox_t`，上位机 Web 滑块可直接修改 MCU PID 参数；
- **高速瞬态捕获（Transient Scope）**：支持在中断服务函数（ISR）中以 10kHz+ 记录环形缓冲区，抓取阶跃响应与故障瞬态；
- **原子快照（SeqLock）**：保护多轴/多传感器数据，防止上位机读取时发生跨周期撕裂。

## 集成方法

### 方法 1：CMake 工程引入（CLion / VSCode / STM32CubeIDE CMake）

```cmake
add_subdirectory(path/to/OmniScope/sdk/mcu)
target_link_libraries(your_firmware PRIVATE OmniScope::MCU)
```

### 方法 2：源码拷贝（Keil MDK / IAR / 现有 Makefile）

直接将：
- `include/omniscope/mcu/mailbox.h` 加入工程头文件包含目录
- `src/mailbox.c` 加入工程 C 源文件编译列表

## 代码使用示例

```c
#include "omniscope/mcu/mailbox.h"

// 1. 全局定义调参邮箱与示波器缓冲区
omniscope_mailbox_t g_tuning_mailbox;
omniscope_trace_buffer_t g_trace_buf;

void System_Init(void) {
    omniscope_mailbox_init(&g_tuning_mailbox);
    omniscope_trace_init(&g_trace_buf);
}

void Main_Loop(void) {
    while (1) {
        // 主循环中检查上位机是否有新参数下发
        if (omniscope_mailbox_has_update(&g_tuning_mailbox)) {
            pid_kp = omniscope_mailbox_get_param(&g_tuning_mailbox, 0, 1.0f);
            pid_ki = omniscope_mailbox_get_param(&g_tuning_mailbox, 1, 0.0f);
            pid_kd = omniscope_mailbox_get_param(&g_tuning_mailbox, 2, 0.1f);
            omniscope_mailbox_acknowledge(&g_tuning_mailbox);
        }
    }
}

// 2. 在高频控制中断（如 1kHz ~ 10kHz）中写入示波器采样
void Control_ISR(void) {
    float ch[OMNISCOPE_TRACE_CHANNELS] = {target_val, current_val, pid_out, current_iq};
    omniscope_trace_record(&g_trace_buf, get_time_us(), ch);
}
```
