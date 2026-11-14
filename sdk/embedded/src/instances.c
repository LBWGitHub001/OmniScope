/**
 * @file instances.c
 * @brief OmniScope Embedded SDK Shared Global Instances (single definition site)
 *
 * Weak so that an application may override placement with its own strong
 * definition of the same name (e.g. placing the buffers in CCMRAM).
 * Pulled from the static library only when actually referenced — firmware
 * that never touches these symbols pays no SRAM for them.
 */

#include "omniscope/omniscope.h"

omniscope_mailbox_t g_omniscope_mailbox __attribute__((weak));
omniscope_trace_buffer_t g_omniscope_trace __attribute__((weak));
omniscope_plot_t g_omniscope_plot __attribute__((weak));
omniscope_watch_table_t g_omniscope_watch __attribute__((weak));
