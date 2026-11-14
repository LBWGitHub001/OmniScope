/**
 * @file instances.h
 * @brief OmniScope Embedded SDK Shared Global Instances
 *
 * The SDK ships ready-to-use global instances of every debug structure,
 * defined once in src/instances.c as WEAK symbols. Applications simply
 * include this header and call omniscope_embedded_init() — no variable
 * definitions needed in application code.
 *
 * Symbol names follow the host auto-discovery convention:
 *   g_omniscope_mailbox / g_omniscope_trace / g_omniscope_plot / g_omniscope_watch
 * The OmniScope host (SWD feature) resolves exactly these names from the
 * firmware ELF — do not rename them.
 *
 * Notes:
 *  - All four instances live in SRAM (.bss), ~15.6KB total. They are linked
 *    from a static library, so firmware that never references them pays
 *    nothing (the object is simply not pulled in).
 *  - Definitions are weak: an application may define its own strong symbol
 *    with the same name to override placement (e.g. into CCMRAM) — the SDK
 *    copy is then discarded by the linker.
 */

#ifndef OMNISCOPE_MCU_INSTANCES_H
#define OMNISCOPE_MCU_INSTANCES_H

#include "omniscope/mcu/mailbox.h"
#include "omniscope/mcu/plot.h"
#include "omniscope/mcu/watch.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Shared instances (weak definitions in src/instances.c) */
extern omniscope_mailbox_t g_omniscope_mailbox;
extern omniscope_trace_buffer_t g_omniscope_trace;
extern omniscope_plot_t g_omniscope_plot;
extern omniscope_watch_table_t g_omniscope_watch;

/**
 * @brief Initialize all four shared instances (call once at startup,
 *        before any task touches them).
 */
static inline void omniscope_embedded_init(void)
{
    omniscope_mailbox_init(&g_omniscope_mailbox);
    omniscope_trace_init(&g_omniscope_trace);
    omniscope_plot_init(&g_omniscope_plot);
    omniscope_watch_init(&g_omniscope_watch);
}

#ifdef __cplusplus
}
#endif

#endif /* OMNISCOPE_MCU_INSTANCES_H */
