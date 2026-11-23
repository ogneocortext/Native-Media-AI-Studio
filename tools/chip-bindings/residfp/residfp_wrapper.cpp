/*
 * libresidfp C Wrapper
 * Provides C API for the C++ reSIDfp library
 */

#include "residfp.h"
#include <stdlib.h>
#include <string.h>

/* Opaque handle */
typedef struct {
    reSIDfp::residfp* sid;
} Residfp_Handle;

/* Create and initialize a new SID */
Residfp_Handle* residfp_create(void) {
    Residfp_Handle* handle = (Residfp_Handle*)malloc(sizeof(Residfp_Handle));
    if (!handle) return NULL;
    handle->sid = new reSIDfp::residfp();
    return handle;
}

/* Destroy SID */
void residfp_destroy(Residfp_Handle* handle) {
    if (handle) {
        delete handle->sid;
        free(handle);
    }
}

/* Set chip model: 0 = MOS6581, 1 = CSG8580 */
int residfp_set_chip_model(Residfp_Handle* handle, int model) {
    if (!handle) return 0;
    reSIDfp::ChipModel cm = (model == 0) ? reSIDfp::MOS6581 : reSIDfp::CSG8580;
    return handle->sid->setChipModel(cm) ? 1 : 0;
}

/* Get chip model */
int residfp_get_chip_model(Residfp_Handle* handle) {
    if (!handle) return -1;
    reSIDfp::ChipModel cm = handle->sid->getChipModel();
    return (cm == reSIDfp::MOS6581) ? 0 : 1;
}

/* Set combined waveforms strength: 0 = AVERAGE, 1 = WEAK, 2 = STRONG */
int residfp_set_combined_waveforms(Residfp_Handle* handle, int cws) {
    if (!handle) return 0;
    reSIDfp::CombinedWaveforms cw;
    switch (cws) {
        case 0: cw = reSIDfp::AVERAGE; break;
        case 1: cw = reSIDfp::WEAK; break;
        case 2: cw = reSIDfp::STRONG; break;
        default: return 0;
    }
    return handle->sid->setCombinedWaveforms(cw) ? 1 : 0;
}

/* Reset SID */
void residfp_reset(Residfp_Handle* handle) {
    if (handle) handle->sid->reset();
}

/* Write register */
void residfp_write(Residfp_Handle* handle, int offset, unsigned char value) {
    if (handle) handle->sid->write(offset, value);
}

/* Read register (with side effects) */
unsigned char residfp_read(Residfp_Handle* handle, int offset) {
    if (!handle) return 0;
    return handle->sid->read(offset);
}

/* Peek register (without side effects) */
unsigned char residfp_peek(Residfp_Handle* handle, int offset) {
    if (!handle) return 0;
    return handle->sid->peek(offset);
}

/* Set sampling parameters:
 * method: 0=DECIMATE, 1=RESAMPLE, 2=NONE
 */
int residfp_set_sampling_parameters(Residfp_Handle* handle, double clock_freq, int method, double sample_freq) {
    if (!handle) return 0;
    reSIDfp::SamplingMethod sm;
    switch (method) {
        case 0: sm = reSIDfp::DECIMATE; break;
        case 1: sm = reSIDfp::RESAMPLE; break;
        case 2: sm = reSIDfp::NONE; break;
        default: return 0;
    }
    return handle->sid->setSamplingParameters(clock_freq, sm, sample_freq) ? 1 : 0;
}

/* Clock SID for given cycles, write to buffer (16-bit stereo), return samples produced */
int residfp_clock_cycles(Residfp_Handle* handle, unsigned int cycles, short* buf) {
    if (!handle) return 0;
    return handle->sid->clock(cycles, buf);
}

/* Clock SID to fill buffer, return cycles run */
int residfp_clock_buffer(Residfp_Handle* handle, short* buf, int buf_size) {
    if (!handle) return 0;
    return handle->sid->clock(buf, buf_size);
}

/* Clock digital only (no audio) */
void residfp_clock_digital(Residfp_Handle* handle, unsigned int cycles) {
    if (handle) handle->sid->clockDigital(cycles);
}

/* Clock silent (no audio, digital only for OSC3/ENV3) */
void residfp_clock_silent(Residfp_Handle* handle, unsigned int cycles) {
    if (handle) handle->sid->clockSilent(cycles);
}

/* Enable/disable filter */
void residfp_enable_filter(Residfp_Handle* handle, int enable) {
    if (handle) handle->sid->enableFilter(enable);
}

/* Set filter curve for 6581 */
void residfp_set_filter_6581_curve(Residfp_Handle* handle, double curve) {
    if (handle) handle->sid->setFilter6581Curve(curve);
}

/* Set filter curve for 8580 */
void residfp_set_filter_8580_curve(Residfp_Handle* handle, double curve) {
    if (handle) handle->sid->setFilter8580Curve(curve);
}

/* Set 6581 caps type: 0 = 2200pF, 1 = 470pF, 2 = 330pF */
void residfp_set_6581_caps(Residfp_Handle* handle, int type) {
    if (!handle) return;
    reSIDfp::CapsType ct;
    switch (type) {
        case 0: ct = reSIDfp::CAPS2200; break;
        case 1: ct = reSIDfp::CAPS470; break;
        case 2: ct = reSIDfp::CAPS330; break;
        default: return;
    }
    handle->sid->set6581caps(ct);
}

/* Enable strong P+S */
void residfp_enable_strong_ps(Residfp_Handle* handle, int enable) {
    if (handle) handle->sid->enableStrongPS(enable);
}

/* Set noise level (0-8) */
void residfp_noise_level(Residfp_Handle* handle, int level) {
    if (handle) handle->sid->noiseLevel(level);
}

/* Set DC blocker resistance (0.0-1.0) */
void residfp_set_dc_blocker(Residfp_Handle* handle, double res) {
    if (handle) handle->sid->setDCBRes(res);
}

/* Set DAC leakage (0.0-1.0) */
void residfp_set_dac_leakage(Residfp_Handle* handle, double level) {
    if (handle) handle->sid->setDacLeakage(level);
}

/* Set 6581 offset (0.0-1.0) */
void residfp_set_offset_6581(Residfp_Handle* handle, double offset) {
    if (handle) handle->sid->setOffset6581(offset);
}

/* Get state size */
int residfp_state_size(Residfp_Handle* handle) {
    if (!handle) return 0;
    return handle->sid->stateSize();
}

/* Save state */
int residfp_save_state(Residfp_Handle* handle, char* buffer, int size) {
    if (!handle) return 0;
    return handle->sid->saveState(buffer, size);
}

/* Restore state */
void residfp_restore_state(Residfp_Handle* handle, char* buffer, int size) {
    if (handle) handle->sid->restoreState(buffer, size);
}

/* Input (EXT IN) */
void residfp_input(Residfp_Handle* handle, int value) {
    if (handle) handle->sid->input(value);
}