/**
 * @file watch.h
 * @brief OmniScope Embedded MCU Watch & Parameter Table (Header-Only)
 *
 * Firmware-declared live variable monitoring and parameter tuning over SWD.
 * The firmware registers named entries describing a variable (address, type,
 * kind, access, dimensions); the host discovers the table via the ELF symbol
 * and polls values non-intrusively through OpenOCD (mdw/mwv), never halting
 * the CPU.
 *
 *  - Monitor entries (OMNISCOPE_KIND_MONITOR) are READ-ONLY: the host UI
 *    offers no write path and the backend rejects write requests.
 *  - Parameter entries (OMNISCOPE_KIND_PARAM) are RW scalars with a
 *    min/max/step range; the host renders a slider and writes directly
 *    (mww), clamped to the declared range.
 *  - Array entries (rows*cols > 1) are always monitors; the host only
 *    re-reads the payload when `version` changes (version-gated fetch),
 *    keeping large matrices (e.g. radar echo maps) cheap to watch.
 *
 * Pure C99, zero dependencies, all APIs are static inline.
 *
 * Host-side memory layout (all fields little-endian, 4-byte aligned):
 *   table header (16 bytes):
 *     0  magic "OMWT" | 4  version | 8  count | 12  capacity
 *   entry (52 bytes each, starting at offset 16):
 *     0   char   name[24]        NUL-terminated "gimbal.pid.kp"
 *     24  u32    ptr             variable address (volatile void*)
 *     28  u8     elem_type       OMNISCOPE_TYPE_*
 *     29  u8     kind            OMNISCOPE_KIND_*
 *     30  u8     access          OMNISCOPE_ACCESS_*
 *     31  u8     flags           reserved, 0
 *     32  u16    rows            1 for scalar / 1-D
 *     34  u16    cols            1 for scalar; elements per row otherwise
 *     36  u32    version         firmware bumps via omniscope_watch_touch()
 *     40  float  min             slider/heatmap range low  (0 = auto)
 *     44  float  max             slider/heatmap range high (0 = auto)
 *     48  float  step            parameter slider step     (0 = free)
 *   total: 16 + 32*52 = 1680 bytes
 */

#ifndef OMNISCOPE_MCU_WATCH_H
#define OMNISCOPE_MCU_WATCH_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>

#ifdef __cplusplus
extern "C" {
#endif

#define OMNISCOPE_WATCH_MAGIC        0x4F4D5754U /* "OMWT" in ASCII */
#define OMNISCOPE_WATCH_VERSION      1U
#define OMNISCOPE_WATCH_MAX_ENTRIES  32U
#define OMNISCOPE_WATCH_NAME_LEN     24U

/* Element types (omniscope_watch_entry_t.elem_type) */
enum {
    OMNISCOPE_TYPE_F32 = 0,
    OMNISCOPE_TYPE_I32 = 1,
    OMNISCOPE_TYPE_U32 = 2,
    OMNISCOPE_TYPE_I16 = 3,
    OMNISCOPE_TYPE_U16 = 4,
    OMNISCOPE_TYPE_I8  = 5,
    OMNISCOPE_TYPE_U8  = 6
};

/* Entry kinds (omniscope_watch_entry_t.kind) */
enum {
    OMNISCOPE_KIND_MONITOR = 0, /* read-only watch (scalars and arrays) */
    OMNISCOPE_KIND_PARAM   = 1  /* tunable parameter (RW scalar, host slider) */
};

/* Access flags (omniscope_watch_entry_t.access) */
enum {
    OMNISCOPE_ACCESS_RO = 0,    /* host must not write (UI disables, API rejects) */
    OMNISCOPE_ACCESS_RW = 1     /* host may write directly (mww) */
};

typedef struct {
    char            name[OMNISCOPE_WATCH_NAME_LEN]; /* NUL-terminated */
    volatile void  *ptr;                            /* variable address */
    uint8_t         elem_type;                      /* OMNISCOPE_TYPE_* */
    uint8_t         kind;                           /* OMNISCOPE_KIND_* */
    uint8_t         access;                         /* OMNISCOPE_ACCESS_* */
    uint8_t         flags;                          /* reserved, keep 0 */
    uint16_t        rows;                           /* 1 for scalar / 1-D */
    uint16_t        cols;                           /* 1 for scalar */
    volatile uint32_t version;                      /* bump after payload update */
    float           min;                            /* display/tuning range low  (0=auto) */
    float           max;                            /* display/tuning range high (0=auto) */
    float           step;                           /* parameter slider step (0=free) */
} __attribute__((aligned(4))) omniscope_watch_entry_t;

typedef struct {
    uint32_t magic;                             /* OMNISCOPE_WATCH_MAGIC */
    uint32_t version;                           /* OMNISCOPE_WATCH_VERSION */
    volatile uint32_t count;                    /* registered entries */
    uint32_t capacity;                          /* OMNISCOPE_WATCH_MAX_ENTRIES */
    omniscope_watch_entry_t entries[OMNISCOPE_WATCH_MAX_ENTRIES];
} __attribute__((aligned(4))) omniscope_watch_table_t;

/* Layout locks: the host decoder mirrors these offsets verbatim. */
_Static_assert(sizeof(omniscope_watch_entry_t) == 52, "watch entry layout");
_Static_assert(offsetof(omniscope_watch_entry_t, ptr) == 24, "watch entry ptr");
_Static_assert(offsetof(omniscope_watch_entry_t, version) == 36, "watch entry version");
_Static_assert(offsetof(omniscope_watch_table_t, entries) == 16, "watch table layout");

/**
 * @brief Element size in bytes for an OMNISCOPE_TYPE_* value (0 on invalid).
 */
static inline uint8_t omniscope_type_size(uint8_t elem_type)
{
    switch (elem_type) {
    case OMNISCOPE_TYPE_F32:
    case OMNISCOPE_TYPE_I32:
    case OMNISCOPE_TYPE_U32: return 4U;
    case OMNISCOPE_TYPE_I16:
    case OMNISCOPE_TYPE_U16: return 2U;
    case OMNISCOPE_TYPE_I8:
    case OMNISCOPE_TYPE_U8:  return 1U;
    default:                 return 0U;
    }
}

/**
 * @brief Initialize a watch table instance (call once at startup).
 */
static inline void omniscope_watch_init(omniscope_watch_table_t *table)
{
    if (!table) return;
    memset(table, 0, sizeof(*table));
    table->magic    = OMNISCOPE_WATCH_MAGIC;
    table->version  = OMNISCOPE_WATCH_VERSION;
    table->capacity = OMNISCOPE_WATCH_MAX_ENTRIES;
}

/**
 * @brief Full-parameter entry registration (shared backend of the helpers).
 * @return entry index >= 0, or -1 when the table is full / args invalid
 */
static inline int omniscope_watch_register_ex(omniscope_watch_table_t *table,
                                              const char *name, volatile void *ptr,
                                              uint8_t elem_type, uint8_t kind, uint8_t access,
                                              uint16_t rows, uint16_t cols,
                                              float min, float max, float step)
{
    if (!table || !name || !ptr) return -1;
    if (omniscope_type_size(elem_type) == 0U) return -1;
    if (table->count >= table->capacity) return -1;
    uint32_t idx = table->count;
    omniscope_watch_entry_t *e = &table->entries[idx];
    memset(e, 0, sizeof(*e));
    strncpy(e->name, name, OMNISCOPE_WATCH_NAME_LEN - 1U);
    e->ptr       = ptr;
    e->elem_type = elem_type;
    e->kind      = kind;
    e->access    = access;
    e->rows      = rows;
    e->cols      = cols;
    e->version   = 0U;
    e->min       = min;
    e->max       = max;
    e->step      = step;
    table->count = idx + 1U;
    return (int)idx;
}

/**
 * @brief Register a read-only scalar monitor (host polls value each cycle).
 */
static inline int omniscope_watch_register_scalar(omniscope_watch_table_t *table,
                                                  const char *name, volatile void *ptr,
                                                  uint8_t elem_type)
{
    return omniscope_watch_register_ex(table, name, ptr, elem_type,
                                       OMNISCOPE_KIND_MONITOR, OMNISCOPE_ACCESS_RO,
                                       1U, 1U, 0.0f, 0.0f, 0.0f);
}

/**
 * @brief Register a read-only array/matrix monitor (version-gated fetch).
 * @note  Call omniscope_watch_touch() after the firmware finishes updating
 *        the payload so the host knows to re-read it.
 */
static inline int omniscope_watch_register_array(omniscope_watch_table_t *table,
                                                 const char *name, volatile void *ptr,
                                                 uint8_t elem_type,
                                                 uint16_t rows, uint16_t cols)
{
    return omniscope_watch_register_ex(table, name, ptr, elem_type,
                                       OMNISCOPE_KIND_MONITOR, OMNISCOPE_ACCESS_RO,
                                       rows, cols, 0.0f, 0.0f, 0.0f);
}

/**
 * @brief Register a tunable parameter (RW scalar; host slider writes via mww,
 *        clamped to [min, max] with the given step).
 */
static inline int omniscope_watch_register_param(omniscope_watch_table_t *table,
                                                 const char *name, volatile void *ptr,
                                                 uint8_t elem_type,
                                                 float min, float max, float step)
{
    return omniscope_watch_register_ex(table, name, ptr, elem_type,
                                       OMNISCOPE_KIND_PARAM, OMNISCOPE_ACCESS_RW,
                                       1U, 1U, min, max, step);
}

/**
 * @brief Set the display range (heatmap color scale etc.) of an entry.
 */
static inline void omniscope_watch_set_range(omniscope_watch_table_t *table,
                                             uint32_t idx, float min, float max)
{
    if (!table || idx >= table->count) return;
    table->entries[idx].min = min;
    table->entries[idx].max = max;
}

/**
 * @brief Bump an entry's version after its payload was updated.
 *        The host re-reads array payloads only when this changes.
 */
static inline void omniscope_watch_touch(omniscope_watch_table_t *table, uint32_t idx)
{
    if (!table || idx >= table->count) return;
    table->entries[idx].version++;
}

#ifdef __cplusplus
}
#endif

#endif /* OMNISCOPE_MCU_WATCH_H */
