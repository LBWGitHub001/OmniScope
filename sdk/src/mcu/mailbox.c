/**
 * @file mailbox.c
 * @brief OmniScope Embedded MCU Debug Mailbox & Trace Buffer Implementation
 */

#include "omniscope/mcu/mailbox.h"

void omniscope_mailbox_init(omniscope_mailbox_t *mb)
{
    if (!mb) return;
    mb->magic = OMNISCOPE_MAILBOX_MAGIC;
    mb->version = OMNISCOPE_MAILBOX_VERSION;
    mb->seq = 0;
    mb->status = OMNISCOPE_STATUS_IDLE;
    for (uint32_t i = 0; i < OMNISCOPE_MAX_TUNING_PARAMS; ++i) {
        mb->params[i] = 0.0f;
    }
    for (uint32_t i = 0; i < 4; ++i) {
        mb->reserved[i] = 0;
    }
}

bool omniscope_mailbox_has_update(const omniscope_mailbox_t *mb)
{
    return (mb != 0) && (mb->status & OMNISCOPE_STATUS_HOST_DIRTY);
}

void omniscope_mailbox_acknowledge(omniscope_mailbox_t *mb)
{
    if (!mb) return;
    mb->status &= ~OMNISCOPE_STATUS_HOST_DIRTY;
    mb->status |= OMNISCOPE_STATUS_MCU_APPLIED;
}

void omniscope_mailbox_set_param(omniscope_mailbox_t *mb, uint32_t index, float value)
{
    if (!mb || index >= OMNISCOPE_MAX_TUNING_PARAMS) return;
    mb->params[index] = value;
}

float omniscope_mailbox_get_param(const omniscope_mailbox_t *mb, uint32_t index, float default_val)
{
    if (!mb || index >= OMNISCOPE_MAX_TUNING_PARAMS) return default_val;
    return mb->params[index];
}

void omniscope_trace_init(omniscope_trace_buffer_t *buf)
{
    if (!buf) return;
    buf->head = 0;
    buf->triggered = 0;
    buf->trigger_index = 0;
    buf->buffer_size = OMNISCOPE_TRACE_BUFFER_SIZE;
    for (uint32_t i = 0; i < OMNISCOPE_TRACE_BUFFER_SIZE; ++i) {
        buf->samples[i].timestamp_us = 0;
        for (uint32_t ch = 0; ch < OMNISCOPE_TRACE_CHANNELS; ++ch) {
            buf->samples[i].channels[ch] = 0.0f;
        }
    }
}

void omniscope_trace_record(omniscope_trace_buffer_t *buf, uint32_t timestamp_us, const float channels[OMNISCOPE_TRACE_CHANNELS])
{
    if (!buf) return;
    uint32_t idx = buf->head % OMNISCOPE_TRACE_BUFFER_SIZE;
    buf->samples[idx].timestamp_us = timestamp_us;
    if (channels) {
        for (uint32_t ch = 0; ch < OMNISCOPE_TRACE_CHANNELS; ++ch) {
            buf->samples[idx].channels[ch] = channels[ch];
        }
    }
    buf->head++;
}

void omniscope_trace_trigger(omniscope_trace_buffer_t *buf)
{
    if (!buf) return;
    buf->triggered = 1;
    buf->trigger_index = buf->head % OMNISCOPE_TRACE_BUFFER_SIZE;
}

void omniscope_seqlock_init(omniscope_seqlock_t *lock)
{
    if (!lock) return;
    lock->sequence = 0;
}

void omniscope_seqlock_write_begin(omniscope_seqlock_t *lock)
{
    if (!lock) return;
    lock->sequence++;
}

void omniscope_seqlock_write_end(omniscope_seqlock_t *lock)
{
    if (!lock) return;
    lock->sequence++;
}

uint32_t omniscope_seqlock_read_begin(const omniscope_seqlock_t *lock)
{
    if (!lock) return 0;
    return lock->sequence;
}

bool omniscope_seqlock_read_retry(const omniscope_seqlock_t *lock, uint32_t start_seq)
{
    if (!lock) return false;
    /* If start_seq is odd (write in progress) or sequence changed, retry needed */
    return (start_seq & 1U) || (lock->sequence != start_seq);
}
