/*
 * libresidfp C Wrapper Header
 * Provides C API for the C++ reSIDfp library
 */

#ifndef RESIDFP_WRAPPER_H
#define RESIDFP_WRAPPER_H

#include <stdint.h>
#include <stdlib.h>

/* Opaque handle */
typedef struct Residfp_Handle Residfp_Handle;

/* Create and initialize a new SID */
Residfp_Handle* residfp_create(void);

/* Destroy SID */
void residfp_destroy(Residfp_Handle* handle);

/* Set chip model: 0 = MOS6581, 1 = MOS8580 */
int residfp_set_chip_model(Residfp_Handle* handle, int model);

/* Get chip model */
int residfp_get_chip_model(Residfp_Handle* handle);

/* Set combined waveforms strength: 0 = off, 1 = weak, 2 = medium, 3 = strong */
int residfp_set_combined_waveforms(Residfp_Handle* handle, int cws);

/* Reset SID */
void residfp_reset(Residfp_Handle* handle);

/* Write register */
void residfp_write(Residfp_Handle* handle, int offset, unsigned char value);

/* Read register (with side effects) */
unsigned char residfp_read(Residfp_Handle* handle, int offset);

/* Peek register (without side effects) */
unsigned char residfp_peek(Residfp_Handle* handle, int offset);

/* Set sampling parameters:
 * method: 0=SAMPLE_FAST, 1=SAMPLE_INTERPOLATE, 2=SAMPLE_RESAMPLE_FAST, 3=SAMPLE_RESAMPLE_INTERPOLATE
 */
int residfp_set_sampling_parameters(Residfp_Handle* handle, double clock_freq, int method, double sample_freq);

/* Clock SID for given cycles, write to buffer (16-bit stereo), return samples produced */
int residfp_clock_cycles(Residfp_Handle* handle, unsigned int cycles, short* buf);

/* Clock SID to fill buffer, return cycles run */
int residfp_clock_buffer(Residfp_Handle* handle, short* buf, int buf_size);

/* Clock digital only (no audio) */
void residfp_clock_digital(Residfp_Handle* handle, unsigned int cycles);

/* Clock silent (no audio, digital only for OSC3/ENV3) */
void residfp_clock_silent(Residfp_Handle* handle, unsigned int cycles);

/* Enable/disable filter */
void residfp_enable_filter(Residfp_Handle* handle, int enable);

/* Set filter curve for 6581 */
void residfp_set_filter_6581_curve(Residfp_Handle* handle, double curve);

/* Set filter curve for 8580 */
void residfp_set_filter_8580_curve(Residfp_Handle* handle, double curve);

/* Set 6581 caps type: 0 = 2200pF, 1 = 470pF, 2 = 330pF */
void residfp_set_6581_caps(Residfp_Handle* handle, int type);

/* Enable strong P+S */
void residfp_enable_strong_ps(Residfp_Handle* handle, int enable);

/* Set noise level (0-8) */
void residfp_noise_level(Residfp_Handle* handle, int level);

/* Set DC blocker resistance (0.0-1.0) */
void residfp_set_dc_blocker(Residfp_Handle* handle, double res);

/* Set DAC leakage (0.0-1.0) */
void residfp_set_dac_leakage(Residfp_Handle* handle, double level);

/* Set 6581 offset (0.0-1.0) */
void residfp_set_offset_6581(Residfp_Handle* handle, double offset);

/* Get state size */
int residfp_state_size(Residfp_Handle* handle);

/* Save state */
int residfp_save_state(Residfp_Handle* handle, char* buffer, int size);

/* Restore state */
void residfp_restore_state(Residfp_Handle* handle, char* buffer, int size);

/* Input (EXT IN) */
void residfp_input(Residfp_Handle* handle, int value);

#endif /* RESIDFP_WRAPPER_H */