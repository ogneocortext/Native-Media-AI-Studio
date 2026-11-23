/*
 * Nuked-OPL3 Python C Extension
 * Wraps the Nuked-OPL3 YMF262/OPL2/OPL3 emulator for Python
 * Build: python setup.py build_ext --inplace
 */

#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* Include Nuked-OPL3 headers */
#include "opl3.h"

/* Module state - must start with PyObject_HEAD for proper Python object layout */
typedef struct {
    PyObject_HEAD
    opl3_chip chip;
    int sample_rate;        /* Target output sample rate (e.g., 44100) */
    int master_clock;       /* Master clock in Hz (e.g., 14318180 for OPL3) */
    double clock_ratio;     /* master_clock / sample_rate */
    double phase_accumulator; /* For resampling */
    int16_t last_samples[4]; /* 4-channel output (OPL3 stereo) */
} NukedOPL3_State;

/* Forward declarations */
static PyObject* NukedOPL3_new(PyTypeObject* type, PyObject* args, PyObject* kwds);
static void NukedOPL3_dealloc(NukedOPL3_State* self);
static int NukedOPL3_init(NukedOPL3_State* self, PyObject* args, PyObject* kwds);
static PyObject* NukedOPL3_reset(NukedOPL3_State* self, PyObject* args);
static PyObject* NukedOPL3_write(NukedOPL3_State* self, PyObject* args);
static PyObject* NukedOPL3_write_buffered(NukedOPL3_State* self, PyObject* args);
static PyObject* NukedOPL3_generate(NukedOPL3_State* self, PyObject* args, PyObject* kwds);
static PyObject* NukedOPL3_generate_4ch(NukedOPL3_State* self, PyObject* args, PyObject* kwds);

/* Method definitions */
static PyMethodDef NukedOPL3_methods[] = {
    {"reset", (PyCFunction)NukedOPL3_reset, METH_VARARGS, "Reset the chip (samplerate)"},
    {"write", (PyCFunction)NukedOPL3_write, METH_VARARGS, "Write register (reg, data)"},
    {"write_buffered", (PyCFunction)NukedOPL3_write_buffered, METH_VARARGS, "Write register buffered (reg, data)"},
    {"generate", (PyCFunction)NukedOPL3_generate, METH_VARARGS | METH_KEYWORDS, "Generate stereo audio samples (num_samples)"},
    {"generate_4ch", (PyCFunction)NukedOPL3_generate_4ch, METH_VARARGS | METH_KEYWORDS, "Generate 4-channel audio samples (num_samples)"},
    {NULL}  /* Sentinel */
};

/* Type definition */
static PyTypeObject NukedOPL3_Type = {
    PyVarObject_HEAD_INIT(NULL, 0)
    .tp_name = "nuked_opl3.NukedOPL3",
    .tp_basicsize = sizeof(NukedOPL3_State),
    .tp_dealloc = (destructor)NukedOPL3_dealloc,
    .tp_flags = Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE,
    .tp_doc = "Nuked-OPL3 YMF262/OPL2/OPL3 emulator",
    .tp_methods = NukedOPL3_methods,
    .tp_new = NukedOPL3_new,
    .tp_init = (initproc)NukedOPL3_init,
};

/* Module definition */
static PyModuleDef nuked_opl3_module = {
    PyModuleDef_HEAD_INIT,
    .m_name = "nuked_opl3",
    .m_doc = "Nuked-OPL3 Python bindings",
    .m_size = -1,
};

/* Module init */
PyMODINIT_FUNC PyInit_nuked_opl3(void) {
    if (PyType_Ready(&NukedOPL3_Type) < 0)
        return NULL;
    
    PyObject* m = PyModule_Create(&nuked_opl3_module);
    if (!m)
        return NULL;
    
    Py_INCREF(&NukedOPL3_Type);
    if (PyModule_AddObject(m, "NukedOPL3", (PyObject*)&NukedOPL3_Type) < 0) {
        Py_DECREF(&NukedOPL3_Type);
        Py_DECREF(m);
        return NULL;
    }
    
    return m;
}

/* Constructor */
static PyObject* NukedOPL3_new(PyTypeObject* type, PyObject* args, PyObject* kwds) {
    NukedOPL3_State* self = (NukedOPL3_State*)type->tp_alloc(type, 0);
    if (!self)
        return NULL;
    
    /* Defaults: OPL3 at 14.31818 MHz, 44.1 kHz output */
    self->sample_rate = 49716;  /* OPL3 native sample rate */
    self->master_clock = 14318180;  /* OPL3 standard clock */
    self->clock_ratio = self->master_clock / (double)self->sample_rate;
    self->phase_accumulator = 0.0;
    self->last_samples[0] = 0;
    self->last_samples[1] = 0;
    self->last_samples[2] = 0;
    self->last_samples[3] = 0;
    
    /* Initialize chip */
    OPL3_Reset(&self->chip, self->sample_rate);
    
    return (PyObject*)self;
}

/* Destructor */
static void NukedOPL3_dealloc(NukedOPL3_State* self) {
    Py_TYPE(self)->tp_free((PyObject*)self);
}

/* Init - called after __new__ */
static int NukedOPL3_init(NukedOPL3_State* self, PyObject* args, PyObject* kwds) {
    return 0;
}

/* Reset chip */
static PyObject* NukedOPL3_reset(NukedOPL3_State* self, PyObject* args) {
    int samplerate = self->sample_rate;
    if (!PyArg_ParseTuple(args, "|i", &samplerate))
        return NULL;
    
    self->sample_rate = samplerate;
    self->clock_ratio = self->master_clock / (double)samplerate;
    OPL3_Reset(&self->chip, samplerate);
    self->phase_accumulator = 0.0;
    self->last_samples[0] = 0;
    self->last_samples[1] = 0;
    self->last_samples[2] = 0;
    self->last_samples[3] = 0;
    Py_RETURN_NONE;
}

/* Write register */
static PyObject* NukedOPL3_write(NukedOPL3_State* self, PyObject* args) {
    uint16_t reg;
    uint8_t data;
    
    if (!PyArg_ParseTuple(args, "HB", &reg, &data))
        return NULL;
    
    OPL3_WriteReg(&self->chip, reg, data);
    Py_RETURN_NONE;
}

/* Write register buffered */
static PyObject* NukedOPL3_write_buffered(NukedOPL3_State* self, PyObject* args) {
    uint16_t reg;
    uint8_t data;
    
    if (!PyArg_ParseTuple(args, "HB", &reg, &data))
        return NULL;
    
    OPL3_WriteRegBuffered(&self->chip, reg, data);
    Py_RETURN_NONE;
}

/* Generate stereo audio samples */
static PyObject* NukedOPL3_generate(NukedOPL3_State* self, PyObject* args, PyObject* kwds) {
    Py_ssize_t num_samples;
    
    static char* kwlist[] = {"num_samples", NULL};
    if (!PyArg_ParseTupleAndKeywords(args, kwds, "n", kwlist, &num_samples))
        return NULL;
    
    if (num_samples <= 0) {
        Py_RETURN_NONE;
    }
    
    /* OPL3 generates 2 channels (stereo) */
    Py_ssize_t buffer_size = num_samples * 2;
    int16_t* output = (int16_t*)PyMem_Malloc(buffer_size * sizeof(int16_t));
    if (!output) {
        return PyErr_NoMemory();
    }
    
    int16_t buffer[2];
    
    for (Py_ssize_t i = 0; i < num_samples; i++) {
        /* Accumulate internal clocks needed for this output sample */
        self->phase_accumulator += self->clock_ratio;
        int clocks_to_run = (int)self->phase_accumulator;
        self->phase_accumulator -= clocks_to_run;
        
        int32_t acc_left = 0;
        int32_t acc_right = 0;
        int samples_accumulated = 0;
        
        /* Run internal clocks */
        for (int c = 0; c < clocks_to_run; c++) {
            OPL3_Generate(&self->chip, buffer);
            acc_left += buffer[0];
            acc_right += buffer[1];
            samples_accumulated++;
        }
        
        /* If no clocks ran, use last values */
        if (samples_accumulated == 0) {
            output[i * 2] = self->last_samples[0];
            output[i * 2 + 1] = self->last_samples[1];
        } else {
            int16_t avg_left = (int16_t)(acc_left / samples_accumulated);
            int16_t avg_right = (int16_t)(acc_right / samples_accumulated);
            output[i * 2] = avg_left;
            output[i * 2 + 1] = avg_right;
            self->last_samples[0] = avg_left;
            self->last_samples[1] = avg_right;
        }
    }
    
    PyObject* result = PyBytes_FromStringAndSize((const char*)output, buffer_size * sizeof(int16_t));
    PyMem_Free(output);
    return result;
}

/* Generate 4-channel audio samples (for OPL3 4-channel mode) */
static PyObject* NukedOPL3_generate_4ch(NukedOPL3_State* self, PyObject* args, PyObject* kwds) {
    Py_ssize_t num_samples;
    
    static char* kwlist[] = {"num_samples", NULL};
    if (!PyArg_ParseTupleAndKeywords(args, kwds, "n", kwlist, &num_samples))
        return NULL;
    
    if (num_samples <= 0) {
        Py_RETURN_NONE;
    }
    
    /* OPL3 4-channel mode generates 4 channels */
    Py_ssize_t buffer_size = num_samples * 4;
    int16_t* output = (int16_t*)PyMem_Malloc(buffer_size * sizeof(int16_t));
    if (!output) {
        return PyErr_NoMemory();
    }
    
    int16_t buffer[4];
    
    for (Py_ssize_t i = 0; i < num_samples; i++) {
        self->phase_accumulator += self->clock_ratio;
        int clocks_to_run = (int)self->phase_accumulator;
        self->phase_accumulator -= clocks_to_run;
        
        int32_t acc[4] = {0, 0, 0, 0};
        int samples_accumulated = 0;
        
        for (int c = 0; c < clocks_to_run; c++) {
            OPL3_Generate4Ch(&self->chip, buffer);
            for (int ch = 0; ch < 4; ch++) {
                acc[ch] += buffer[ch];
            }
            samples_accumulated++;
        }
        
        if (samples_accumulated == 0) {
            for (int ch = 0; ch < 4; ch++) {
                output[i * 4 + ch] = self->last_samples[ch];
            }
        } else {
            for (int ch = 0; ch < 4; ch++) {
                int16_t avg = (int16_t)(acc[ch] / samples_accumulated);
                output[i * 4 + ch] = avg;
                self->last_samples[ch] = avg;
            }
        }
    }
    
    PyObject* result = PyBytes_FromStringAndSize((const char*)output, buffer_size * sizeof(int16_t));
    PyMem_Free(output);
    return result;
}