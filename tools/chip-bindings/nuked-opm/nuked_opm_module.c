/*
 * Nuked-OPM Python C Extension
 * Wraps the Nuked-OPM YM2151 emulator for Python
 * Build: python setup.py build_ext --inplace
 */

#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* Include Nuked-OPM headers */
#include "opm.h"

/* Module state - must start with PyObject_HEAD for proper Python object layout */
typedef struct {
    PyObject_HEAD
    opm_t chip;
    int chip_type;          /* opm_flags_none or opm_flags_ym2164 */
    int sample_rate;        /* Target output sample rate (e.g., 44100) */
    int master_clock;       /* Master clock in Hz (e.g., 3579545 for YM2151) */
    double clock_ratio;     /* master_clock / sample_rate */
    double phase_accumulator; /* For resampling */
    int16_t last_left;
    int16_t last_right;
    uint8_t last_sh1;
    uint8_t last_sh2;
    uint8_t last_so;
} NukedOPM_State;

/* Forward declarations */
static PyObject* NukedOPM_new(PyTypeObject* type, PyObject* args, PyObject* kwds);
static void NukedOPM_dealloc(NukedOPM_State* self);
static int NukedOPM_init(NukedOPM_State* self, PyObject* args, PyObject* kwds);
static PyObject* NukedOPM_reset(NukedOPM_State* self, PyObject* args);
static PyObject* NukedOPM_write(NukedOPM_State* self, PyObject* args);
static PyObject* NukedOPM_read(NukedOPM_State* self, PyObject* args);
static PyObject* NukedOPM_read_irq(NukedOPM_State* self, PyObject* args);
static PyObject* NukedOPM_read_ct1(NukedOPM_State* self, PyObject* args);
static PyObject* NukedOPM_read_ct2(NukedOPM_State* self, PyObject* args);
static PyObject* NukedOPM_clock(NukedOPM_State* self, PyObject* args);
static PyObject* NukedOPM_propagate(NukedOPM_State* self, PyObject* args);
static PyObject* NukedOPM_generate(NukedOPM_State* self, PyObject* args, PyObject* kwds);
static PyObject* NukedOPM_set_chip_type(NukedOPM_State* self, PyObject* args);

/* Method definitions */
static PyMethodDef NukedOPM_methods[] = {
    {"reset", (PyCFunction)NukedOPM_reset, METH_NOARGS, "Reset the chip"},
    {"write", (PyCFunction)NukedOPM_write, METH_VARARGS, "Write to a port (port, data)"},
    {"read", (PyCFunction)NukedOPM_read, METH_VARARGS, "Read from a port (port)"},
    {"read_irq", (PyCFunction)NukedOPM_read_irq, METH_NOARGS, "Read IRQ status"},
    {"read_ct1", (PyCFunction)NukedOPM_read_ct1, METH_NOARGS, "Read CT1 timer"},
    {"read_ct2", (PyCFunction)NukedOPM_read_ct2, METH_NOARGS, "Read CT2 timer"},
    {"clock", (PyCFunction)NukedOPM_clock, METH_VARARGS, "Run N clock cycles and return raw output"},
    {"propagate", (PyCFunction)NukedOPM_propagate, METH_VARARGS, "Run N cycles to propagate register writes"},
    {"generate", (PyCFunction)NukedOPM_generate, METH_VARARGS | METH_KEYWORDS, "Generate audio samples (num_samples)"},
    {"set_chip_type", (PyCFunction)NukedOPM_set_chip_type, METH_VARARGS, "Set chip type (0=YM2151, 1=YM2164)"},
    {NULL}  /* Sentinel */
};

/* Type definition */
static PyTypeObject NukedOPM_Type = {
    PyVarObject_HEAD_INIT(NULL, 0)
    .tp_name = "nuked_opm.NukedOPM",
    .tp_basicsize = sizeof(NukedOPM_State),
    .tp_dealloc = (destructor)NukedOPM_dealloc,
    .tp_flags = Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE,
    .tp_doc = "Nuked-OPM YM2151/YM2164 emulator",
    .tp_methods = NukedOPM_methods,
    .tp_new = NukedOPM_new,
    .tp_init = (initproc)NukedOPM_init,
};

/* Module definition */
static PyModuleDef nuked_opm_module = {
    PyModuleDef_HEAD_INIT,
    .m_name = "nuked_opm",
    .m_doc = "Nuked-OPM Python bindings",
    .m_size = -1,
};

/* Module init */
PyMODINIT_FUNC PyInit_nuked_opm(void) {
    if (PyType_Ready(&NukedOPM_Type) < 0)
        return NULL;
    
    PyObject* m = PyModule_Create(&nuked_opm_module);
    if (!m)
        return NULL;
    
    Py_INCREF(&NukedOPM_Type);
    if (PyModule_AddObject(m, "NukedOPM", (PyObject*)&NukedOPM_Type) < 0) {
        Py_DECREF(&NukedOPM_Type);
        Py_DECREF(m);
        return NULL;
    }
    
    /* Constants */
    PyModule_AddIntConstant(m, "FLAGS_NONE", opm_flags_none);
    PyModule_AddIntConstant(m, "FLAGS_YM2164", opm_flags_ym2164);
    
    return m;
}

/* Constructor */
static PyObject* NukedOPM_new(PyTypeObject* type, PyObject* args, PyObject* kwds) {
    NukedOPM_State* self = (NukedOPM_State*)type->tp_alloc(type, 0);
    if (!self)
        return NULL;
    
    /* Defaults: YM2151 at 3.58 MHz, 44.1 kHz output */
    self->chip_type = opm_flags_none;
    self->sample_rate = 44100;
    self->master_clock = 3579545;  /* YM2151 standard clock */
    self->clock_ratio = self->master_clock / (double)self->sample_rate;
    self->phase_accumulator = 0.0;
    self->last_left = 0;
    self->last_right = 0;
    self->last_sh1 = 0;
    self->last_sh2 = 0;
    self->last_so = 0;
    
    /* Initialize chip */
    OPM_Reset(&self->chip, self->chip_type);
    
    return (PyObject*)self;
}

/* Destructor */
static void NukedOPM_dealloc(NukedOPM_State* self) {
    Py_TYPE(self)->tp_free((PyObject*)self);
}

/* Init - called after __new__ */
static int NukedOPM_init(NukedOPM_State* self, PyObject* args, PyObject* kwds) {
    return 0;
}

/* Reset chip */
static PyObject* NukedOPM_reset(NukedOPM_State* self, PyObject* args) {
    OPM_Reset(&self->chip, self->chip_type);
    self->phase_accumulator = 0.0;
    self->last_left = 0;
    self->last_right = 0;
    self->last_sh1 = 0;
    self->last_sh2 = 0;
    self->last_so = 0;
    Py_RETURN_NONE;
}

/* Write to port */
static PyObject* NukedOPM_write(NukedOPM_State* self, PyObject* args) {
    uint32_t port;
    uint8_t data;
    
    if (!PyArg_ParseTuple(args, "IB", &port, &data))
        return NULL;
    
    OPM_Write(&self->chip, port, data);
    Py_RETURN_NONE;
}

/* Read from port */
static PyObject* NukedOPM_read(NukedOPM_State* self, PyObject* args) {
    uint32_t port;
    if (!PyArg_ParseTuple(args, "I", &port))
        return NULL;
    
    uint8_t result = OPM_Read(&self->chip, port);
    return PyLong_FromUnsignedLong(result);
}

/* Read IRQ */
static PyObject* NukedOPM_read_irq(NukedOPM_State* self, PyObject* args) {
    uint8_t result = OPM_ReadIRQ(&self->chip);
    return PyLong_FromUnsignedLong(result);
}

/* Read CT1 */
static PyObject* NukedOPM_read_ct1(NukedOPM_State* self, PyObject* args) {
    uint8_t result = OPM_ReadCT1(&self->chip);
    return PyLong_FromUnsignedLong(result);
}

/* Read CT2 */
static PyObject* NukedOPM_read_ct2(NukedOPM_State* self, PyObject* args) {
    uint8_t result = OPM_ReadCT2(&self->chip);
    return PyLong_FromUnsignedLong(result);
}

/* Clock - run N internal clock cycles and return raw stereo output */
static PyObject* NukedOPM_clock(NukedOPM_State* self, PyObject* args) {
    Py_ssize_t num_clocks;
    if (!PyArg_ParseTuple(args, "n", &num_clocks))
        return NULL;
    
    if (num_clocks <= 0) {
        Py_RETURN_NONE;
    }
    
    Py_ssize_t buffer_size = num_clocks * 2;
    int16_t* output = (int16_t*)PyMem_Malloc(buffer_size * sizeof(int16_t));
    if (!output) {
        return PyErr_NoMemory();
    }
    
    int32_t out[2];
    uint8_t sh1, sh2, so;
    
    for (Py_ssize_t i = 0; i < num_clocks; i++) {
        OPM_Clock(&self->chip, out, &sh1, &sh2, &so);
        output[i * 2] = (int16_t)out[0];
        output[i * 2 + 1] = (int16_t)out[1];
    }
    
    PyObject* result = PyBytes_FromStringAndSize((const char*)output, buffer_size * sizeof(int16_t));
    PyMem_Free(output);
    return result;
}

/* Propagate - run N internal clock cycles without returning output */
static PyObject* NukedOPM_propagate(NukedOPM_State* self, PyObject* args) {
    Py_ssize_t num_clocks;
    if (!PyArg_ParseTuple(args, "n", &num_clocks))
        return NULL;
    
    if (num_clocks <= 0) {
        Py_RETURN_NONE;
    }
    
    int32_t out[2];
    uint8_t sh1, sh2, so;
    
    for (Py_ssize_t i = 0; i < num_clocks; i++) {
        OPM_Clock(&self->chip, out, &sh1, &sh2, &so);
    }
    
    Py_RETURN_NONE;
}

/* Generate audio samples with linear interpolation resampling */
static PyObject* NukedOPM_generate(NukedOPM_State* self, PyObject* args, PyObject* kwds) {
    Py_ssize_t num_samples;
    int stereo = 1;
    
    static char* kwlist[] = {"num_samples", "stereo", NULL};
    if (!PyArg_ParseTupleAndKeywords(args, kwds, "n|p", kwlist, &num_samples, &stereo))
        return NULL;
    
    if (num_samples <= 0) {
        Py_RETURN_NONE;
    }
    
    /* Allocate output buffer */
    Py_ssize_t out_channels = stereo ? 2 : 1;
    Py_ssize_t buffer_size = num_samples * out_channels;
    int16_t* output = (int16_t*)PyMem_Malloc(buffer_size * sizeof(int16_t));
    if (!output) {
        return PyErr_NoMemory();
    }
    
    int32_t out[2];
    uint8_t sh1, sh2, so;
    
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
            OPM_Clock(&self->chip, out, &sh1, &sh2, &so);
            acc_left += out[0];
            acc_right += out[1];
            samples_accumulated++;
        }
        
        /* If no clocks ran (very high sample rate), use last values */
        if (samples_accumulated == 0) {
            output[i * out_channels] = self->last_left;
            if (stereo)
                output[i * out_channels + 1] = self->last_right;
        } else {
            /* Average the accumulated samples */
            int16_t avg_left = (int16_t)(acc_left / samples_accumulated);
            int16_t avg_right = (int16_t)(acc_right / samples_accumulated);
            output[i * out_channels] = avg_left;
            self->last_left = avg_left;
            if (stereo) {
                output[i * out_channels + 1] = avg_right;
                self->last_right = avg_right;
            }
        }
    }
    
    /* Create bytes object from buffer */
    PyObject* result = PyBytes_FromStringAndSize((const char*)output, buffer_size * sizeof(int16_t));
    PyMem_Free(output);
    return result;
}

/* Set chip type */
static PyObject* NukedOPM_set_chip_type(NukedOPM_State* self, PyObject* args) {
    uint32_t type;
    if (!PyArg_ParseTuple(args, "I", &type))
        return NULL;
    
    self->chip_type = type;
    OPM_Reset(&self->chip, type);
    Py_RETURN_NONE;
}