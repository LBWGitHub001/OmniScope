/**
 * @file plot.h
 * @brief OmniScope Embedded MCU Named-Channel Plot FIFO (Header-Only)
 *
 * Call-time push plotting for bare-metal / RTOS firmware over SWD.
 * The firmware pushes (timestamp, channel, value) points into a lock-free
 * single-writer ring buffer in SRAM; the host drains it non-intrusively
 * via OpenOCD (mdw/mwv) without halting the CPU.
 *
 * Pure C99, zero dependencies, all APIs are static inline.
 *
 * Host-side memory layout (all fields little-endian, 4-byte aligned):
 *   offset  size  field
 *   ------  ----  ------------------------------------------
 *   0       4     magic        (OMNISCOPE_PLOT_MAGIC "OMPL")
 *   4       4     version      (OMNISCOPE_PLOT_VERSION)
 *   8       4     write_seq    total points pushed (monotonic)
 *   12      4     read_seq     host drains up to here (host-written)
 *   16      4     dropped      points overwritten before host read
 *   20      4     fifo_size    (OMNISCOPE_PLOT_FIFO_SIZE)
 *   24      4     channel_count
 *   28      448   channels[16] { char name[24]; uint32 active; }
 *   476     8192  points[512]  { seq, ts_us, channel, value } x16B
 *   total: 8668 bytes
 *
 * Host drain protocol:
 *   1. read header; if write_seq == read_seq there is nothing new
 *   2. host starts at max(read_seq, write_seq - fifo_size); a positive
 *      gap between expected seq and point seq means data was lost
 *   3. read points[seq % fifo_size] for the new range
 *   4. mww read_seq = newest consumed seq + 1, enabling firmware-side
 *      dropped accounting
 */

#ifndef OMNISCOPE_MCU_PLOT_H
#define OMNISCOPE_MCU_PLOT_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>

#ifdef __cplusplus
extern "C" {
#endif

#define OMNISCOPE_PLOT_MAGIC          0x4F4D504CU /* "OMPL" in ASCII */
#define OMNISCOPE_PLOT_VERSION        1U
#define OMNISCOPE_PLOT_MAX_CHANNELS   16U
#define OMNISCOPE_PLOT_NAME_LEN       24U
#define OMNISCOPE_PLOT_FIFO_SIZE      512U /* power of two */

/* Firmware timestamp source used by the OMNISCOPE_PLOT macro.
 * Override before including this header, e.g.:
 *   #define OMNISCOPE_PLOT_TIMESTAMP_US() (HAL_GetTick() * 1000U)
 * Defaults to 0 (host then falls back to its own reception time). */
#ifndef OMNISCOPE_PLOT_TIMESTAMP_US
#define OMNISCOPE_PLOT_TIMESTAMP_US() (0U)
#endif

typedef struct {
    char     name[OMNISCOPE_PLOT_NAME_LEN]; /* NUL-terminated channel name */
    uint32_t active;                        /* 1 once registered */
} __attribute__((aligned(4))) omniscope_plot_channel_t;

typedef struct {
    uint32_t seq;     /* copy of write_seq at push time (torn-read check) */
    uint32_t ts_us;   /* firmware timestamp in microseconds */
    uint32_t channel; /* index into channels[] */
    float    value;
} __attribute__((aligned(4))) omniscope_plot_point_t;

typedef struct {
    uint32_t magic;                         /* OMNISCOPE_PLOT_MAGIC */
    uint32_t version;                       /* OMNISCOPE_PLOT_VERSION */
    volatile uint32_t write_seq;            /* total points pushed */
    volatile uint32_t read_seq;             /* host-drained watermark (host-written via mww) */
    volatile uint32_t dropped;              /* overwritten-before-read point count */
    uint32_t fifo_size;                     /* OMNISCOPE_PLOT_FIFO_SIZE */
    uint32_t channel_count;
    omniscope_plot_channel_t channels[OMNISCOPE_PLOT_MAX_CHANNELS];
    omniscope_plot_point_t   points[OMNISCOPE_PLOT_FIFO_SIZE];
} __attribute__((aligned(4))) omniscope_plot_t;

/* Layout locks: the host decoder mirrors these offsets verbatim. */
_Static_assert(sizeof(omniscope_plot_point_t) == 16, "plot point layout");
_Static_assert(sizeof(omniscope_plot_channel_t) == 28, "plot channel layout");
_Static_assert(offsetof(omniscope_plot_t, channels) == 28, "plot header layout");
_Static_assert(offsetof(omniscope_plot_t, points) == 476, "plot points layout");

/**
 * @brief Initialize a plot FIFO instance (call once at startup).
 */
static inline void omniscope_plot_init(omniscope_plot_t *plot)
{
    if (!plot) return;
    memset(plot, 0, sizeof(*plot));
    plot->magic     = OMNISCOPE_PLOT_MAGIC;
    plot->version   = OMNISCOPE_PLOT_VERSION;
    plot->fifo_size = OMNISCOPE_PLOT_FIFO_SIZE;
}

/**
 * @brief Register (or look up) a named channel. Idempotent by name.
 * @return channel index >= 0, or -1 if full / invalid args
 */
static inline int omniscope_plot_channel(omniscope_plot_t *plot, const char *name)
{
    if (!plot || !name) return -1;
    for (uint32_t i = 0; i < plot->channel_count; ++i) {
        if (plot->channels[i].active &&
            strncmp(plot->channels[i].name, name, OMNISCOPE_PLOT_NAME_LEN) == 0) {
            return (int)i;
        }
    }
    if (plot->channel_count >= OMNISCOPE_PLOT_MAX_CHANNELS) return -1;
    uint32_t idx = plot->channel_count;
    memset(&plot->channels[idx], 0, sizeof(plot->channels[idx]));
    strncpy(plot->channels[idx].name, name, OMNISCOPE_PLOT_NAME_LEN - 1U);
    plot->channels[idx].active = 1U;
    plot->channel_count = idx + 1U;
    return (int)idx;
}

/**
 * @brief Push one sample into the FIFO. Single-writer (firmware) safe.
 * @note  If the host lags a full buffer behind, the overwritten point is
 *        counted in `dropped` (host must publish read_seq for this).
 */
static inline void omniscope_plot_push(omniscope_plot_t *plot, uint32_t channel,
                                       float value, uint32_t ts_us)
{
    if (!plot || channel >= plot->channel_count) return;
    uint32_t seq = plot->write_seq;
    if (plot->read_seq != 0U && (seq - plot->read_seq) >= plot->fifo_size) {
        plot->dropped++;
    }
    omniscope_plot_point_t *pt = &plot->points[seq % OMNISCOPE_PLOT_FIFO_SIZE];
    pt->ts_us   = ts_us;
    pt->channel = channel;
    pt->value   = value;
    pt->seq     = seq; /* write seq last so readers can detect torn points */
    plot->write_seq = seq + 1U;
}

/**
 * @brief One-liner: plot a named value, caching the channel index in a
 *        function-local static. Timestamp comes from
 *        OMNISCOPE_PLOT_TIMESTAMP_US (override before including this header).
 *
 *   OMNISCOPE_PLOT(&g_omniscope_plot, "gimbal.yaw", yaw_deg);
 */
#define OMNISCOPE_PLOT(plot_ptr, name, value)                                     \
    do {                                                                          \
        static int omniscope_plot_ch_ = -1;                                       \
        if (omniscope_plot_ch_ < 0) {                                             \
            omniscope_plot_ch_ = omniscope_plot_channel((plot_ptr), (name));      \
        }                                                                         \
        if (omniscope_plot_ch_ >= 0) {                                            \
            omniscope_plot_push((plot_ptr), (uint32_t)omniscope_plot_ch_,         \
                                (float)(value), OMNISCOPE_PLOT_TIMESTAMP_US());   \
        }                                                                         \
    } while (0)

#ifdef __cplusplus
}
#endif

#endif /* OMNISCOPE_MCU_PLOT_H */
