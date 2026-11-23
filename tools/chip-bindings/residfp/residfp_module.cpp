/*
 * libresidfp Python C Extension
 * Wraps the libresidfp SID 6581/8580 emulator for Python
 * Build: python setup.py build_ext --inplace
 */

#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* Include libresidfp C wrapper header */
#include "residfp_wrapper.h"

/* Module state */
typedef struct {
    PyObject_HEAD
    Residfp_Handle* handle;
    int sample_rate;        /* Target output sample rate (e.g., 44100) */
    int clock_freq;         /* Clock frequency (985248 PAL, 1022730 NTSC) */
    int chip_model;         /* 0 = MOS6581, 1 = MOS8580 */
    double phase_accumulator;
    int16_t last_left;
    int16_t last_right;
} Residfp_State;

/* Forward declarations */
static PyObject* Residfp_new(PyTypeObject* type, PyObject* args, PyObject* kwds);
static void Residfp_dealloc(Residfp_State* self);
static int Residfp_init(Residfp_State* self, PyObject* args, PyObject* kwds);
static PyObject* Residfp_reset(Residfp_State* self, PyObject* args);
static PyObject* Residfp_write(Residfp_State* self, PyObject* args);
static PyObject* Residfp_read(Residfp_State* self, PyObject* args);
static PyObject* Residfp_peek(Residfp_State* self, PyObject* args);
static PyObject* Residfp_generate(Residfp_State* self, PyObject* args, PyObject* kwds);
static PyObject* Residfp_clock_cycles(Residfp_State* self, PyObject* args);
static PyObject* Residfp_set_chip_model(Residfp_State* self, PyObject* args);
static PyObject* Residfp_set_sampling(Residfp_State* self, PyObject* args);
static PyObject* Residfp_enable_filter(Residfp_State* self, PyObject* args);
static PyObject* Residfp_set_filter_curve(Residfp_State* self, PyObject* args);

/* Method definitions */
static PyMethodDef Residfp_methods[] = {
    {"reset", (PyCFunction)Residfp_reset, METH_NOARGS, "Reset the chip"},
    {"write", (PyCFunction)Residfp_write, METH_VARARGS, "Write register (offset, value)"},
    {"read", (PyCFunction)Residfp_read, METH_VARARGS, "Read register (offset)"},
    {"peek", (PyCFunction)Residfp_peek, METH_VARARGS, "Peek register without side effects (offset)"},
    {"generate", (PyCFunction)Residfp_generate, METH_VARARGS | METH_KEYWORDS, "Generate audio samples (num_samples)"},
    {"clock_cycles", (PyCFunction)Residfp_clock_cycles, METH_VARARGS, "Run N clock cycles and return raw output"},
    {"set_chip_model", (PyCFunction)Residfp_set_chip_model, METH_VARARGS, "Set chip model (0=MOS6581, 1=MOS8580)"},
    {"set_sampling", (PyCFunction)Residfp_set_sampling, METH_VARARGS, "Set sampling parameters (clock_freq, method, sample_freq)"},
    {"enable_filter", (PyCFunction)Residfp_enable_filter, METH_VARARGS, "Enable/disable filter"},
    {"set_filter_curve", (PyCFunction)Residfp_set_filter_curve, METH_VARARGS, "Set filter curve (model, curve)"},
    {NULL}  /* Sentinel */
};

/* Type definition */
static PyTypeObject Residfp_Type = {
    PyVarObject_HEAD_INIT(NULL, 0)
    "residfp.Residfp",           /* tp_name */
    sizeof(Residfp_State),       /* tp_basicsize */
    0,                           /* tp_itemsize */
    (destructor)Residfp_dealloc, /* tp_dealloc */
    0,                           /* tp_print */
    0,                           /* tp_getattr */
    0,                           /* tp_setattr */
    0,                           /* tp_reserved */
    0,                           /* tp_repr */
    0,                           /* tp_as_number */
    0,                           /* tp_as_sequence */
    0,                           /* tp_as_mapping */
    0,                           /* tp_hash  */
    0,                           /* tp_call */
    0,                           /* tp_str */
    0,                           /* tp_getattro */
    0,                           /* tp_setattro */
    0,                           /* tp_as_buffer */
    Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE, /* tp_flags */
    "libresidfp SID 6581/8580 emulator", /* tp_doc */
    0,                           /* tp_traverse */
    0,                           /* tp_clear */
    0,                           /* tp_richcompare */
    0,                           /* tp_weaklistoffset */
    0,                           /* tp_iter */
    0,                           /* tp_iternext */
    Residfp_methods,             /* tp_methods */
    0,                           /* tp_members */
    0,                           /* tp_getset */
    0,                           /* tp_base */
    0,                           /* tp_dict */
    0,                           /* tp_descr_get */
    0,                           /* tp_descr_set */
    0,                           /* tp_dictoffset */
    (initproc)Residfp_init,      /* tp_init */
    0,                           /* tp_alloc */
    Residfp_new,                 /* tp_new */
};

/* Module definition */
static PyModuleDef residfp_module = {
    PyModuleDef_HEAD_INIT,
    "residfp",           /* m_name */
    "libresidfp Python bindings", /* m_doc */
    -1,                  /* m_size */
    NULL,                /* m_methods */
    NULL,                /* m_slots */
    NULL,                /* m_traverse */
    NULL,                /* m_clear */
    NULL,                /* m_free */
};

/* Module init */
PyMODINIT_FUNC PyInit_residfp(void) {
    if (PyType_Ready(&Residfp_Type) < 0)
        return NULL;
    
    PyObject* m = PyModule_Create(&residfp_module);
    if (!m)
        return NULL;
    
    Py_INCREF(&Residfp_Type);
    if (PyModule_AddObject(m, "Residfp", (PyObject*)&Residfp_Type) < 0) {
        Py_DECREF(&Residfp_Type);
        Py_DECREF(m);
        return NULL;
    }
    
    /* Constants */
    PyModule_AddIntConstant(m, "MOS6581", 0);
    PyModule_AddIntConstant(m, "CSG8580", 1);
    PyModule_AddIntConstant(m, "DECIMATE", 0);
    PyModule_AddIntConstant(m, "RESAMPLE", 1);
    PyModule_AddIntConstant(m, "NONE", 2);
    PyModule_AddIntConstant(m, "AVERAGE", 0);
    PyModule_AddIntConstant(m, "WEAK", 1);
    PyModule_AddIntConstant(m, "STRONG", 2);
    PyModule_AddIntConstant(m, "CAPS2200", 0);
    PyModule_AddIntConstant(m, "CAPS470", 1);
    PyModule_AddIntConstant(m, "CAPS330", 2);
    
    return m;
}

/* Constructor */
static PyObject* Residfp_new(PyTypeObject* type, PyObject* args, PyObject* kwds) {
    Residfp_State* self = (Residfp_State*)type->tp_alloc(type, 0);
    if (!self)
        return NULL;
    
    /* Defaults: MOS6581 (NTSC), 44.1 kHz output */
    self->handle = residfp_create();
    if (!self->handle) {
        PyErr_SetString(PyExc_MemoryError, "Failed to create residfp handle");
        return NULL;
    }
    
    self->sample_rate = 44100;
    self->clock_freq = 1022730;  /* NTSC C64 */
    self->chip_model = 0;  /* MOS6581 */
    self->phase_accumulator = 0.0;
    self->last_left = 0;
    self->last_right = 0;
    
    /* Set default chip model and sampling */
    residfp_set_chip_model(self->handle, self->chip_model);
    residfp_set_sampling_parameters(self->handle, self->clock_freq, 3, self->sample_rate);  // RESAMPLE_INTERPOLATE
    residfp_enable_filter(self->handle, 1);
    
    return (PyObject*)self;
}

/* Destructor */
static void Residfp_dealloc(Residfp_State* self) {
    if (self->handle) {
        residfp_destroy(self->handle);
    }
    Py_TYPE(self)->tp_free((PyObject*)self);
}

/* Init */
static int Residfp_init(Residfp_State* self, PyObject* args, PyObject* kwds) {
    return 0;
}

/* Reset */
static PyObject* Residfp_reset(Residfp_State* self, PyObject* args) {
    residfp_reset(self->handle);
    self->phase_accumulator = 0.0;
    self->last_left = 0;
    self->last_right = 0;
    Py_RETURN_NONE;
}

/* Write register */
static PyObject* Residfp_write(Residfp_State* self, PyObject* args) {
    int offset;
    int value;
    if (!PyArg_ParseTuple(args, "ii", &offset, &value))
        return NULL;
    
    residfp_write(self->handle, offset, (unsigned char)value);
    Py_RETURN_NONE;
}

/* Read register */
static PyObject* Residfp_read(Residfp_State* self, PyObject* args) {
    int offset;
    if (!PyArg_ParseTuple(args, "i", &offset))
        return NULL;
    
    unsigned char result = residfp_read(self->handle, offset);
    return PyLong_FromUnsignedLong(result);
}

/* Peek register */
static PyObject* Residfp_peek(Residfp_State* self, PyObject* args) {
    int offset;
    if (!PyArg_ParseTuple(args, "i", &offset))
        return NULL;
    
    unsigned char result = residfp_peek(self->handle, offset);
    return PyLong_FromUnsignedLong(result);
}

/* Generate audio samples */
static PyObject* Residfp_generate(Residfp_State* self, PyObject* args, PyObject* kwds) {
    Py_ssize_t num_samples;
    int stereo = 1;
    
    static char* kwlist[] = {"num_samples", "stereo", NULL};
    if (!PyArg_ParseTupleAndKeywords(args, kwds, "n|p", kwlist, &num_samples, &stereo))
        return NULL;
    
    if (num_samples <= 0) {
        Py_RETURN_NONE;
    }
    
    Py_ssize_t out_channels = stereo ? 2 : 1;
    Py_ssize_t buffer_size = num_samples * out_channels;
    int16_t* output = (int16_t*)PyMem_Malloc(buffer_size * sizeof(int16_t));
    if (!output) {
        return PyErr_NoMemory();
    }
    
    /* Calculate how many clock cycles to run to produce num_samples */
    double cycles_per_sample = (double)self->clock_freq / self->sample_rate;
    unsigned int total_cycles = (unsigned int)(num_samples * cycles_per_sample + 10);
    
    /* Use clock_cycles method */
    int16_t* temp_buf = (int16_t*)malloc(buffer_size * sizeof(int16_t));
    if (!temp_buf) {
        PyMem_Free(output);
        return PyErr_NoMemory();
    }
    
    int samples_produced = residfp_clock_cycles(self->handle, total_cycles, (short*)temp_buf);
    int samples_per_channel = samples_produced / out_channels;
    if (samples_per_channel > (int)num_samples) samples_per_channel = (int)num_samples;
    
    for (int i = 0; i < samples_per_channel; i++) {
        output[i * out_channels] = temp_buf[i * out_channels];
        if (stereo) {
            output[i * out_channels + 1] = temp_buf[i * out_channels + 1];
        }
    }
    
    /* Pad remaining with last values */
    for (int i = samples_per_channel; i < (int)num_samples; i++) {
        output[i * out_channels] = self->last_left;
        if (stereo) {
            output[i * out_channels + 1] = self->last_right;
        }
    }
    
    if (samples_per_channel > 0) {
        self->last_left = output[(samples_per_channel - 1) * out_channels];
        if (stereo) {
            self->last_right = output[(samples_per_channel - 1) * out_channels + 1];
        }
    }
    
    free(temp_buf);
    
    PyObject* result = PyBytes_FromStringAndSize((const char*)output, buffer_size * sizeof(int16_t));
    PyMem_Free(output);
    return result;
}

/* Clock N cycles and return raw output */
static PyObject* Residfp_clock_cycles(Residfp_State* self, PyObject* args) {
    unsigned int cycles;
    if (!PyArg_ParseTuple(args, "I", &cycles))
        return NULL;
    
    if (cycles == 0) {
        Py_RETURN_NONE;
    }
    
    /* Estimate buffer size: cycles / clock_freq * sample_rate * 2 channels */
    int estimated_samples = (int)((double)cycles / self->clock_freq * self->sample_rate) + 10;
    int buffer_size = estimated_samples * 2;
    short* buf = (short*)malloc(buffer_size * sizeof(short));
    if (!buf) {
        return PyErr_NoMemory();
    }
    
    int samples_produced = residfp_clock_cycles(self->handle, cycles, buf);
    int bytes_size = samples_produced * 2 * sizeof(short);  // stereo
    
    PyObject* result = PyBytes_FromStringAndSize((const char*)buf, bytes_size);
    free(buf);
    return result;
}

/* Set chip model */
static PyObject* Residfp_set_chip_model(Residfp_State* self, PyObject* args) {
    int model;
    if (!PyArg_ParseTuple(args, "i", &model))
        return NULL;
    
    if (model < 0 || model > 1) {
        PyErr_SetString(PyExc_ValueError, "Chip model must be 0 (MOS6581) or 1 (MOS8580)");
        return NULL;
    }
    
    self->chip_model = model;
    residfp_set_chip_model(self->handle, model);
    
    /* Adjust clock frequency for model */
    if (model == 0) {  // MOS6581
        self->clock_freq = 1022730;  // NTSC
    } else {  // MOS8580
        self->clock_freq = 985248;  // PAL
    }
    residfp_set_sampling_parameters(self->handle, self->clock_freq, 3, self->sample_rate);
    
    Py_RETURN_NONE;
}

/* Set sampling parameters */
static PyObject* Residfp_set_sampling(Residfp_State* self, PyObject* args) {
    double clock_freq;
    int method;
    double sample_freq;
    if (!PyArg_ParseTuple(args, "did", &clock_freq, &method, &sample_freq))
        return NULL;
    
    if (method < 0 || method > 3) {
        PyErr_SetString(PyExc_ValueError, "Method must be 0-3");
        return NULL;
    }
    
    self->clock_freq = (int)clock_freq;
    self->sample_rate = (int)sample_freq;
    residfp_set_sampling_parameters(self->handle, clock_freq, method, sample_freq);
    Py_RETURN_NONE;
}

/* Enable/disable filter */
static PyObject* Residfp_enable_filter(Residfp_State* self, PyObject* args) {
    int enable;
    if (!PyArg_ParseTuple(args, "p", &enable))
        return NULL;
    
    residfp_enable_filter(self->handle, enable);
    Py_RETURN_NONE;
}

/* Set filter curve */
static PyObject* Residfp_set_filter_curve(Residfp_State* self, PyObject* args) {
    int model;
    double curve;
    if (!PyArg_ParseTuple(args, "id", &model, &curve))
        return NULL;
    
    if (model == 0) {
        residfp_set_filter_6581_curve(self->handle, curve);
    } else if (model == 1) {
        residfp_set_filter_8580_curve(self->handle, curve);
    } else {
        PyErr_SetString(PyExc_ValueError, "Model must be 0 (6581) or 1 (8580)");
        return NULL;
    }
    Py_RETURN_NONE;
}