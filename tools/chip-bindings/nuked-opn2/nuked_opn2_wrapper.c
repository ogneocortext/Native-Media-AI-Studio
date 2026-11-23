/*
 * Nuked-OPN2 Shared Library Wrapper
 * Exports C functions for use via ctypes
 * Build: cl /DLL /O2 /Fe:nuked_opn2.dll nuked_opn2_wrapper.c ym3438.c
 */

#define NUKED_OPN2_EXPORT __declspec(dllexport)

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
#include "ym3438.h"

/* DllMain */
BOOL APIENTRY DllMain(HMODULE hModule, DWORD ul_reason_for_call, LPVOID lpReserved) {
    return TRUE;
}

/* Opaque handle */
typedef struct {
    ym3438_t chip;
} NukedOPN2_Handle;

/* Create and initialize a new chip */
NUKED_OPN2_EXPORT NukedOPN2_Handle* nuked_opn2_create(uint32_t chip_type, uint32_t master_clock) {
    NukedOPN2_Handle* handle = (NukedOPN2_Handle*)malloc(sizeof(NukedOPN2_Handle));
    if (!handle) return NULL;
    
    OPN2_SetChipType(chip_type);
    OPN2_Reset(&handle->chip);
    
    return handle;
}

/* Destroy chip */
NUKED_OPN2_EXPORT void nuked_opn2_destroy(NukedOPN2_Handle* handle) {
    if (handle) free(handle);
}

/* Reset chip */
NUKED_OPN2_EXPORT void nuked_opn2_reset(NukedOPN2_Handle* handle) {
    if (handle) OPN2_Reset(&handle->chip);
}

/* Write to port (0-3) */
NUKED_OPN2_EXPORT void nuked_opn2_write(NukedOPN2_Handle* handle, uint32_t port, uint8_t data) {
    if (handle) OPN2_Write(&handle->chip, port, data);
}

/* Run N internal clock cycles, write stereo output to buffer (int16_t*, size = num_clocks * 2) */
NUKED_OPN2_EXPORT void nuked_opn2_clock(NukedOPN2_Handle* handle, uint32_t num_clocks, int16_t* buffer) {
    if (!handle || !buffer) return;
    
    int16_t out[2];
    for (uint32_t i = 0; i < num_clocks; i++) {
        OPN2_Clock(&handle->chip, out);
        buffer[i * 2] = (int16_t)(out[0] << 7);
        buffer[i * 2 + 1] = (int16_t)(out[1] << 7);
    }
}

/* Generate audio at target sample rate with linear interpolation */
NUKED_OPN2_EXPORT void nuked_opn2_generate(NukedOPN2_Handle* handle, uint32_t num_samples, int16_t* buffer, 
                                            uint32_t sample_rate, uint32_t master_clock) {
    if (!handle || !buffer) return;
    
    double internal_clock = master_clock / 6.0;
    double clock_ratio = internal_clock / sample_rate;
    double phase_accumulator = 0.0;
    int16_t last_left = 0, last_right = 0;
    int16_t out[2];
    
    for (uint32_t i = 0; i < num_samples; i++) {
        phase_accumulator += clock_ratio;
        int clocks_to_run = (int)phase_accumulator;
        phase_accumulator -= clocks_to_run;
        
        int32_t acc_left = 0, acc_right = 0;
        int samples_accumulated = 0;
        
        for (int c = 0; c < clocks_to_run; c++) {
            OPN2_Clock(&handle->chip, out);
            int16_t left = (int16_t)(out[0] << 7);
            int16_t right = (int16_t)(out[1] << 7);
            acc_left += left;
            acc_right += right;
            samples_accumulated++;
        }
        
        if (samples_accumulated == 0) {
            buffer[i * 2] = last_left;
            buffer[i * 2 + 1] = last_right;
        } else {
            int16_t avg_left = acc_left / samples_accumulated;
            int16_t avg_right = acc_right / samples_accumulated;
            buffer[i * 2] = avg_left;
            buffer[i * 2 + 1] = avg_right;
            last_left = avg_left;
            last_right = avg_right;
        }
    }
}