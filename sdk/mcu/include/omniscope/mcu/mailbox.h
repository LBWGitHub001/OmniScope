/**
 * @file mailbox.h
 * @brief OmniScope Embedded MCU Debug Mailbox & High-Speed Trace Buffer
 *
 * Designed for bare-metal and RTOS microcontrollers (STM32, ESP32, RP2040, etc.).
 * Provides zero-halt, non-intrusive memory structures for:
 * 1. Live parameter tuning via SWD/DAP memory writes
 * 2. High-speed transient trace buffering (oscilloscope trigger)
 * 3. Atomic multi-variable snapshot protection (SeqLock)
 *
 * Fully compatible with C99/C11 and C++.
 */

#ifndef OMNISCOPE_MCU_MAILBOX_H
#define OMNISCOPE_MCU_MAILBOX_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

#define OMNISCOPE_MAILBOX_MAGIC      0x4F4D5343U /* "OMSC" in ASCII */
#define OMNISCOPE_MAILBOX_VERSION    1U
#define OMNISCOPE_MAX_TUNING_PARAMS  16U
#define OMNISCOPE_TRACE_CHANNELS     4U
#define OMNISCOPE_TRACE_BUFFER_SIZE  256U

/* Mailbox Status Flags */
#define OMNISCOPE_STATUS_IDLE        0x00000000U
#define OMNISCOPE_STATUS_HOST_DIRTY  0x00000001U /* Host updated parameters */
#define OMNISCOPE_STATUS_MCU_APPLIED 0x00000002U /* MCU consumed parameters */
#define OMNISCOPE_STATUS_SAVE_FLASH  0x00000004U /* Request MCU persist to flash */

/**
 * @brief Parameter Tuning Mailbox (Allocated in MCU SRAM)
 * Host SWD monitors/writes this structure to dynamically tune controller gains (e.g. PID).
 */
typedef struct {
    uint32_t magic;                              /* Magic validation (OMNISCOPE_MAILBOX_MAGIC) */
    uint32_t version;                            /* Structure version */
    volatile uint32_t seq;                       /* Incremented on each update */
    volatile uint32_t status;                    /* OMNISCOPE_STATUS_* flags */
    volatile float params[OMNISCOPE_MAX_TUNING_PARAMS]; /* Parameter slots (e.g. kp, ki, kd, filter_hz) */
    uint32_t reserved[4];
} __attribute__((aligned(4))) omniscope_mailbox_t;

/**
 * @brief Transient Trace Point (10kHz+ ISR sampled)
 */
typedef struct {
    uint32_t timestamp_us;                       /* Microsecond or CPU clock counter */
    float channels[OMNISCOPE_TRACE_CHANNELS];    /* e.g. target, actual, error, output */
} __attribute__((aligned(4))) omniscope_trace_point_t;

/**
 * @brief Oscilloscope Ring Buffer for Transient Capture
 * Records high-frequency data in control ISR without halting CPU.
 */
typedef struct {
    volatile uint32_t head;                      /* Write pointer */
    volatile uint32_t triggered;                 /* 1 if trigger event fired */
    volatile uint32_t trigger_index;             /* Buffer index where trigger happened */
    uint32_t buffer_size;                        /* Number of points (OMNISCOPE_TRACE_BUFFER_SIZE) */
    omniscope_trace_point_t samples[OMNISCOPE_TRACE_BUFFER_SIZE];
} __attribute__((aligned(4))) omniscope_trace_buffer_t;

/**
 * @brief SeqLock structure for atomic multi-variable snapshot
 */
typedef struct {
    volatile uint32_t sequence;
} omniscope_seqlock_t;

/* --- Mailbox Functions --- */

void omniscope_mailbox_init(omniscope_mailbox_t *mb);
bool omniscope_mailbox_has_update(const omniscope_mailbox_t *mb);
void omniscope_mailbox_acknowledge(omniscope_mailbox_t *mb);
void omniscope_mailbox_set_param(omniscope_mailbox_t *mb, uint32_t index, float value);
float omniscope_mailbox_get_param(const omniscope_mailbox_t *mb, uint32_t index, float default_val);

/* --- High-Speed Trace Buffer Functions --- */

void omniscope_trace_init(omniscope_trace_buffer_t *buf);
void omniscope_trace_record(omniscope_trace_buffer_t *buf, uint32_t timestamp_us, const float channels[OMNISCOPE_TRACE_CHANNELS]);
void omniscope_trace_trigger(omniscope_trace_buffer_t *buf);

/* --- SeqLock Functions (Atomic Snapshot) --- */

void omniscope_seqlock_init(omniscope_seqlock_t *lock);
void omniscope_seqlock_write_begin(omniscope_seqlock_t *lock);
void omniscope_seqlock_write_end(omniscope_seqlock_t *lock);
uint32_t omniscope_seqlock_read_begin(const omniscope_seqlock_t *lock);
bool omniscope_seqlock_read_retry(const omniscope_seqlock_t *lock, uint32_t start_seq);

#ifdef __cplusplus
}
#endif

#endif /* OMNISCOPE_MCU_MAILBOX_H */
