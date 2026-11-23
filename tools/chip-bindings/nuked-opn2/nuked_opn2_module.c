/*
 * Nuked-OPN2 Python C Extension
 * Wraps the Nuked-OPN2 YM3438/YM2612 emulator for Python
 * 
 * Build: python setup.py build_ext --inplace
 */

#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* Include Nuked-OPN2 headers */
#include "ym3438.h"

/* Module state - must start with PyObject_HEAD for proper Python object layout */
typedef struct {
    PyObject_HEAD
    ym3438_t chip;
    int chip_type;          /* ym3438_mode_ym2612 etc */
    int sample_rate;        /* Target output sample rate (e.g., 44100) */
    int master_clock;       /* Master clock in Hz (e.g., 7670454 for NTSC Genesis) */
    double internal_clock;  /* master_clock / 6 */
    double clock_ratio;     /* internal_clock / sample_rate */
    double phase_accumulator; /* For resampling */
    int16_t last_left;
    int16_t last_right;
} NukedOPN2_State;

/* Forward declarations */
static PyObject* NukedOPN2_new(PyTypeObject* type, PyObject* args, PyObject* kwds);
static void NukedOPN2_dealloc(NukedOPN2_State* self);
static int NukedOPN2_init(NukedOPN2_State* self, PyObject* args, PyObject* kwds);
static PyObject* NukedOPN2_reset(NukedOPN2_State* self, PyObject* args);
static PyObject* NukedOPN2_write(NukedOPN2_State* self, PyObject* args);
static PyObject* NukedOPN2_read(NukedOPN2_State* self, PyObject* args);
static PyObject* NukedOPN2_read_test_pin(NukedOPN2_State* self, PyObject* args);
static PyObject* NukedOPN2_generate(NukedOPN2_State* self, PyObject* args, PyObject* kwds);
static PyObject* NukedOPN2_clock(NukedOPN2_State* self, PyObject* args);
static PyObject* NukedOPN2_propagate(NukedOPN2_State* self, PyObject* args);
static PyObject* NukedOPN2_write_register(NukedOPN2_State* self, PyObject* args);
static PyObject* NukedOPN2_set_chip_type(NukedOPN2_State* self, PyObject* args);

/* Method definitions */
static PyMethodDef NukedOPN2_methods[] = {
    {"reset", (PyCFunction)NukedOPN2_reset, METH_NOARGS, "Reset the chip"},
    {"write", (PyCFunction)NukedOPN2_write, METH_VARARGS, "Write to a port (port, data)"},
    {"read", (PyCFunction)NukedOPN2_read, METH_VARARGS, "Read from a port (port)"},
    {"read_test_pin", (PyCFunction)NukedOPN2_read_test_pin, METH_VARARGS, "Read test pin value"},
    {"generate", (PyCFunction)NukedOPN2_generate, METH_VARARGS | METH_KEYWORDS, "Generate audio samples (num_samples)"},
    {"clock", (PyCFunction)NukedOPN2_clock, METH_VARARGS, "Run N clock cycles and return raw output"},
    {"propagate", (PyCFunction)NukedOPN2_propagate, METH_VARARGS, "Run N cycles to propagate register writes"},
    {"write_register", (PyCFunction)NukedOPN2_write_register, METH_VARARGS, "Write register with proper timing (addr, data)"},
    {"set_chip_type", (PyCFunction)NukedOPN2_set_chip_type, METH_VARARGS, "Set chip type (0=YM3438, 1=YM2612)"},
    {NULL}  /* Sentinel */
};

/* Type definition */
static PyTypeObject NukedOPN2_Type = {
    PyVarObject_HEAD_INIT(NULL, 0)
    .tp_name = "nuked_opn2.NukedOPN2",
    .tp_basicsize = sizeof(NukedOPN2_State),
    .tp_dealloc = (destructor)NukedOPN2_dealloc,
    .tp_flags = Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE,
    .tp_doc = "Nuked-OPN2 YM3438/YM2612 emulator",
    .tp_methods = NukedOPN2_methods,
    .tp_new = NukedOPN2_new,
    .tp_init = (initproc)NukedOPN2_init,
};

/* Module definition */
static PyModuleDef nuked_opn2_module = {
    PyModuleDef_HEAD_INIT,
    .m_name = "nuked_opn2",
    .m_doc = "Nuked-OPN2 Python bindings",
    .m_size = -1,
};

/* Module init */
PyMODINIT_FUNC PyInit_nuked_opn2(void) {
    if (PyType_Ready(&NukedOPN2_Type) < 0)
        return NULL;
    
    PyObject* m = PyModule_Create(&nuked_opn2_module);
    if (!m)
        return NULL;
    
    Py_INCREF(&NukedOPN2_Type);
    if (PyModule_AddObject(m, "NukedOPN2", (PyObject*)&NukedOPN2_Type) < 0) {
        Py_DECREF(&NukedOPN2_Type);
        Py_DECREF(m);
        return NULL;
    }
    
    /* Constants */
    PyModule_AddIntConstant(m, "MODE_YM2612", ym3438_mode_ym2612);
    PyModule_AddIntConstant(m, "MODE_READMODE", ym3438_mode_readmode);
    
    return m;
}

/* Constructor */
static PyObject* NukedOPN2_new(PyTypeObject* type, PyObject* args, PyObject* kwds) {
    printf("NukedOPN2_new: allocating\n");
    fflush(stdout);
    NukedOPN2_State* self = (NukedOPN2_State*)type->tp_alloc(type, 0);
    if (!self) {
        printf("NukedOPN2_new: allocation failed\n");
        fflush(stdout);
        return NULL;
    }
    
    printf("NukedOPN2_new: setting defaults\n");
    fflush(stdout);
    /* Defaults: NTSC Genesis */
    self->chip_type = ym3438_mode_ym2612;
    self->sample_rate = 44100;
    self->master_clock = 7670454;  /* NTSC Genesis master clock */
    self->internal_clock = self->master_clock / 6.0;
    self->clock_ratio = self->internal_clock / self->sample_rate;
    self->phase_accumulator = 0.0;
    self->last_left = 0;
    self->last_right = 0;
    
    printf("NukedOPN2_new: calling OPN2_SetChipType\n");
    fflush(stdout);
    /* Initialize chip type globally */
    OPN2_SetChipType(self->chip_type);
    
    printf("NukedOPN2_new: calling OPN2_Reset\n");
    fflush(stdout);
    /* Reset chip */
    OPN2_Reset(&self->chip);
    
    printf("NukedOPN2_new: done, returning self=%p\n", (void*)self);
    fflush(stdout);
    return (PyObject*)self;
}

/* Init - called after __new__ */
static int NukedOPN2_init(NukedOPN2_State* self, PyObject* args, PyObject* kwds) {
    printf("NukedOPN2_init called\n");
    fflush(stdout);
    return 0;
}

/* Destructor */
static void NukedOPN2_dealloc(NukedOPN2_State* self) {
    Py_TYPE(self)->tp_free((PyObject*)self);
}

/* Reset chip */
static PyObject* NukedOPN2_reset(NukedOPN2_State* self, PyObject* args) {
    OPN2_Reset(&self->chip);
    self->phase_accumulator = 0.0;
    self->last_left = 0;
    self->last_right = 0;
    Py_RETURN_NONE;
}

/* Write to port */
static PyObject* NukedOPN2_write(NukedOPN2_State* self, PyObject* args) {
    uint32_t port;
    uint8_t data;
    
    if (!PyArg_ParseTuple(args, "IB", &port, &data))
        return NULL;
    
    OPN2_Write(&self->chip, port, data);
    Py_RETURN_NONE;
}

/* Set chip type */
static PyObject* NukedOPN2_set_chip_type(NukedOPN2_State* self, PyObject* args) {
    uint32_t type;
    if (!PyArg_ParseTuple(args, "I", &type))
        return NULL;
    
    self->chip_type = type;
    OPN2_SetChipType(type);
    Py_RETURN_NONE;
}

/* Write register with proper bus timing:
 * 1. Write address to port 0
 * 2. Clock 1 cycle to process address
 * 3. Write data to port 1
 * 4. Clock 1 cycle to process data
 * 5. Clock 24 cycles (full frame) to ensure write is processed for target slot
 */
static PyObject* NukedOPN2_write_register(NukedOPN2_State* self, PyObject* args) {
    uint32_t addr;
    uint8_t data;
    if (!PyArg_ParseTuple(args, "IB", &addr, &data))
        return NULL;
    
    /* Step 1: Write address to port 0 */
    OPN2_Write(&self->chip, 0, (uint8_t)addr);
    
    /* Step 2: Clock 1 cycle to process address */
    int16_t buffer[2];
    OPN2_Clock(&self->chip, buffer);
    
    /* Step 3: Write data to port 1 */
    OPN2_Write(&self->chip, 1, data);
    
    /* Step 4: Clock 1 cycle to process data */
    OPN2_Clock(&self->chip, buffer);
    
    /* Step 5: Clock 24 cycles (full frame) to ensure write is processed
     * The chip processes one operator slot per cycle. There are 12 slots
     * (0-11) that repeat twice per frame (24 cycles). Clocking a full
     * frame ensures the write is applied to the target slot. */
    for (int i = 0; i < 24; i++) {
        OPN2_Clock(&self->chip, buffer);
    }
    
    Py_RETURN_NONE;
}

/* Clock - run N internal clock cycles and return raw stereo output */
static PyObject* NukedOPN2_clock(NukedOPN2_State* self, PyObject* args) {
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
    
    int16_t buffer[2];
    
    for (Py_ssize_t i = 0; i < num_clocks; i++) {
        OPN2_Clock(&self->chip, buffer);
        int16_t left = (int16_t)(buffer[0] << 7);
        int16_t right = (int16_t)(buffer[1] << 7);
        output[i * 2] = left;
        output[i * 2 + 1] = right;
    }
    
    PyObject* result = PyBytes_FromStringAndSize((const char*)output, buffer_size * sizeof(int16_t));
    PyMem_Free(output);
    return result;
}

/* Propagate - run N internal clock cycles without returning output (for register propagation) */
static PyObject* NukedOPN2_propagate(NukedOPN2_State* self, PyObject* args) {
    Py_ssize_t num_clocks;
    if (!PyArg_ParseTuple(args, "n", &num_clocks))
        return NULL;
    
    if (num_clocks <= 0) {
        Py_RETURN_NONE;
    }
    
    int16_t buffer[2];
    
    for (Py_ssize_t i = 0; i < num_clocks; i++) {
        OPN2_Clock(&self->chip, buffer);
    }
    
    Py_RETURN_NONE;
}

/* Read from port */
static PyObject* NukedOPN2_read(NukedOPN2_State* self, PyObject* args) {
    uint32_t port;
    if (!PyArg_ParseTuple(args, "I", &port))
        return NULL;
    
    uint8_t result = OPN2_Read(&self->chip, port);
    return PyLong_FromUnsignedLong(result);
}

/* Read test pin */
static PyObject* NukedOPN2_read_test_pin(NukedOPN2_State* self, PyObject* args) {
    uint32_t result = OPN2_ReadTestPin(&self->chip);
    return PyLong_FromUnsignedLong(result);
}

/* Generate audio samples with linear interpolation resampling */
static PyObject* NukedOPN2_generate(NukedOPN2_State* self, PyObject* args, PyObject* kwds) {
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
    
    int16_t buffer[2];  /* MOL, MOR - signed 9-bit but stored in 16-bit */
    
    for (Py_ssize_t i = 0; i < num_samples; i++) {
        /* Accumulate internal clocks needed for this output sample */
        self->phase_accumulator += self->clock_ratio;
        int clocks_to_run = (int)self->phase_accumulator;
        self->phase_accumulator -= clocks_to_run;
        
        int16_t acc_left = 0;
        int16_t acc_right = 0;
        int samples_accumulated = 0;
        
        /* Run internal clocks */
        for (int c = 0; c < clocks_to_run; c++) {
            OPN2_Clock(&self->chip, buffer);
            /* buffer[0] = MOL (signed 9-bit), buffer[1] = MOR (signed 9-bit) */
            /* Sign-extend from 9-bit to 16-bit */
            int16_t left = (int16_t)(buffer[0] << 7);
            int16_t right = (int16_t)(buffer[1] << 7);
            acc_left += left;
            acc_right += right;
            samples_accumulated++;
        }
        
        /* If no clocks ran (very high sample rate), use last values */
        if (samples_accumulated == 0) {
            output[i * out_channels] = self->last_left;
            if (stereo)
                output[i * out_channels + 1] = self->last_right;
        } else {
            /* Average the accumulated samples */
            int16_t avg_left = acc_left / samples_accumulated;
            int16_t avg_right = acc_right / samples_accumulated;
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