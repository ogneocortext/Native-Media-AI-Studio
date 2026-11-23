/*
 * snes-spc Python C Extension
 * Wraps the snes-spc SPC700 emulator for Python
 * Build: python setup.py build_ext --inplace
 */

#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* Include snes-spc headers */
#include "SNES_SPC.h"
#include "SPC_DSP.h"

/* Module state */
typedef struct {
    PyObject_HEAD
    SNES_SPC* spc;
    int sample_rate;        /* Target output sample rate (e.g., 32000) */
    double phase_accumulator;
    int16_t last_left;
    int16_t last_right;
    SNES_SPC::sample_t* output_buffer;
    int output_buffer_size;
} SnesSpc_State;

/* Forward declarations */
static PyObject* SnesSpc_new(PyTypeObject* type, PyObject* args, PyObject* kwds);
static void SnesSpc_dealloc(SnesSpc_State* self);
static int SnesSpc_init(SnesSpc_State* self, PyObject* args, PyObject* kwds);
static PyObject* SnesSpc_reset(SnesSpc_State* self, PyObject* args);
static PyObject* SnesSpc_write_port(SnesSpc_State* self, PyObject* args);
static PyObject* SnesSpc_read_port(SnesSpc_State* self, PyObject* args);
static PyObject* SnesSpc_play(SnesSpc_State* self, PyObject* args);
static PyObject* SnesSpc_skip(SnesSpc_State* self, PyObject* args);
static PyObject* SnesSpc_generate(SnesSpc_State* self, PyObject* args, PyObject* kwds);
static PyObject* SnesSpc_load_spc(SnesSpc_State* self, PyObject* args);
static PyObject* SnesSpc_clear_echo(SnesSpc_State* self, PyObject* args);
static PyObject* SnesSpc_set_tempo(SnesSpc_State* self, PyObject* args);
static PyObject* SnesSpc_mute_voices(SnesSpc_State* self, PyObject* args);

/* Method definitions */
static PyMethodDef SnesSpc_methods[] = {
    {"reset", (PyCFunction)SnesSpc_reset, METH_NOARGS, "Reset the SPC700"},
    {"write_port", (PyCFunction)SnesSpc_write_port, METH_VARARGS, "Write to a port (time, port, data)"},
    {"read_port", (PyCFunction)SnesSpc_read_port, METH_VARARGS, "Read from a port (time, port)"},
    {"play", (PyCFunction)SnesSpc_play, METH_VARARGS, "Play N sample pairs and return stereo audio"},
    {"skip", (PyCFunction)SnesSpc_skip, METH_VARARGS, "Skip N sample pairs (faster than play)"},
    {"generate", (PyCFunction)SnesSpc_generate, METH_VARARGS | METH_KEYWORDS, "Generate audio samples at target sample rate (num_samples)"},
    {"load_spc", (PyCFunction)SnesSpc_load_spc, METH_VARARGS, "Load SPC file data (bytes)"},
    {"clear_echo", (PyCFunction)SnesSpc_clear_echo, METH_NOARGS, "Clear echo buffer"},
    {"set_tempo", (PyCFunction)SnesSpc_set_tempo, METH_VARARGS, "Set tempo (tempo_unit = 0x100)"},
    {"mute_voices", (PyCFunction)SnesSpc_mute_voices, METH_VARARGS, "Mute voices by mask"},
    {NULL}  /* Sentinel */
};

/* Type definition */
static PyTypeObject SnesSpc_Type = {
    PyVarObject_HEAD_INIT(NULL, 0)
    "snes_spc.SnesSpc",
    sizeof(SnesSpc_State),
    0,                           /* tp_itemsize */
    (destructor)SnesSpc_dealloc, /* tp_dealloc */
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
    "snes-spc SPC700 emulator",
    0,                           /* tp_traverse */
    0,                           /* tp_clear */
    0,                           /* tp_richcompare */
    0,                           /* tp_weaklistoffset */
    0,                           /* tp_iter */
    0,                           /* tp_iternext */
    SnesSpc_methods,             /* tp_methods */
    0,                           /* tp_members */
    0,                           /* tp_getset */
    0,                           /* tp_base */
    0,                           /* tp_dict */
    0,                           /* tp_descr_get */
    0,                           /* tp_descr_set */
    0,                           /* tp_dictoffset */
    (initproc)SnesSpc_init,      /* tp_init */
    0,                           /* tp_alloc */
    SnesSpc_new,                 /* tp_new */
};

/* Module definition */
static PyModuleDef snes_spc_module = {
    PyModuleDef_HEAD_INIT,
    "snes_spc",
    "snes-spc Python bindings",
    -1,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
};

/* Module init */
PyMODINIT_FUNC PyInit_snes_spc(void) {
    if (PyType_Ready(&SnesSpc_Type) < 0)
        return NULL;
    
    PyObject* m = PyModule_Create(&snes_spc_module);
    if (!m)
        return NULL;
    
    Py_INCREF(&SnesSpc_Type);
    if (PyModule_AddObject(m, "SnesSpc", (PyObject*)&SnesSpc_Type) < 0) {
        Py_DECREF(&SnesSpc_Type);
        Py_DECREF(m);
        return NULL;
    }
    
    /* Constants */
    PyModule_AddIntConstant(m, "SAMPLE_RATE", 32000);
    PyModule_AddIntConstant(m, "CLOCK_RATE", 1024000);
    PyModule_AddIntConstant(m, "CLOCKS_PER_SAMPLE", 32);
    PyModule_AddIntConstant(m, "VOICE_COUNT", 8);
    PyModule_AddIntConstant(m, "PORT_COUNT", 4);
    PyModule_AddIntConstant(m, "TEMPO_UNIT", 0x100);
    PyModule_AddIntConstant(m, "ROM_SIZE", 0x40);
    PyModule_AddIntConstant(m, "SPC_MIN_FILE_SIZE", 0x10180);
    PyModule_AddIntConstant(m, "SPC_FILE_SIZE", 0x10200);
    
    return m;
}

/* Constructor */
static PyObject* SnesSpc_new(PyTypeObject* type, PyObject* args, PyObject* kwds) {
    SnesSpc_State* self = (SnesSpc_State*)type->tp_alloc(type, 0);
    if (!self)
        return NULL;
    
    self->spc = new SNES_SPC();
    if (!self->spc) {
        PyErr_SetString(PyExc_MemoryError, "Failed to create SNES_SPC");
        return NULL;
    }
    
    self->sample_rate = 32000;  // Native SPC700 sample rate
    self->phase_accumulator = 0.0;
    self->last_left = 0;
    self->last_right = 0;
    self->output_buffer = NULL;
    self->output_buffer_size = 0;
    
    /* Initialize the emulator */
    blargg_err_t err = self->spc->init();
    if (err) {
        PyErr_Format(PyExc_RuntimeError, "SNES_SPC init failed: %s", err);
        return NULL;
    }
    
    return (PyObject*)self;
}

/* Destructor */
static void SnesSpc_dealloc(SnesSpc_State* self) {
    if (self->spc) {
        delete self->spc;
    }
    if (self->output_buffer) {
        free(self->output_buffer);
    }
    Py_TYPE(self)->tp_free((PyObject*)self);
}

/* Init */
static int SnesSpc_init(SnesSpc_State* self, PyObject* args, PyObject* kwds) {
    return 0;
}

/* Reset */
static PyObject* SnesSpc_reset(SnesSpc_State* self, PyObject* args) {
    self->spc->reset();
    self->phase_accumulator = 0.0;
    self->last_left = 0;
    self->last_right = 0;
    Py_RETURN_NONE;
}

/* Write port */
static PyObject* SnesSpc_write_port(SnesSpc_State* self, PyObject* args) {
    long time;
    int port;
    int data;
    if (!PyArg_ParseTuple(args, "lii", &time, &port, &data))
        return NULL;
    
    self->spc->write_port(time, port, data);
    Py_RETURN_NONE;
}

/* Read port */
static PyObject* SnesSpc_read_port(SnesSpc_State* self, PyObject* args) {
    long time;
    int port;
    if (!PyArg_ParseTuple(args, "li", &time, &port))
        return NULL;
    
    int result = self->spc->read_port(time, port);
    return PyLong_FromLong(result);
}

/* Play - generate stereo audio at native sample rate */
static PyObject* SnesSpc_play(SnesSpc_State* self, PyObject* args) {
    int count;
    if (!PyArg_ParseTuple(args, "i", &count))
        return NULL;
    
    if (count <= 0) {
        Py_RETURN_NONE;
    }
    
    /* Must be multiple of 2 for stereo */
    if (count % 2 != 0) {
        count++;
    }
    
    int buffer_size = count * sizeof(SNES_SPC::sample_t);
    SNES_SPC::sample_t* buf = (SNES_SPC::sample_t*)malloc(buffer_size);
    if (!buf) {
        return PyErr_NoMemory();
    }
    
    blargg_err_t err = self->spc->play(count, buf);
    if (err) {
        free(buf);
        PyErr_Format(PyExc_RuntimeError, "Play failed: %s", err);
        return NULL;
    }
    
    PyObject* result = PyBytes_FromStringAndSize((const char*)buf, buffer_size);
    free(buf);
    return result;
}

/* Skip - faster than play */
static PyObject* SnesSpc_skip(SnesSpc_State* self, PyObject* args) {
    int count;
    if (!PyArg_ParseTuple(args, "i", &count))
        return NULL;
    
    if (count <= 0) {
        Py_RETURN_NONE;
    }
    
    blargg_err_t err = self->spc->skip(count);
    if (err) {
        PyErr_Format(PyExc_RuntimeError, "Skip failed: %s", err);
        return NULL;
    }
    
    Py_RETURN_NONE;
}

/* Generate audio at target sample rate with resampling */
static PyObject* SnesSpc_generate(SnesSpc_State* self, PyObject* args, PyObject* kwds) {
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
    
    /* Generate at native 32kHz, then resample to target */
    double native_rate = 32000.0;
    double ratio = native_rate / self->sample_rate;
    int native_samples = (int)(num_samples * ratio) + 10;
    
    /* Must be even for stereo */
    if (native_samples % 2 != 0) native_samples++;
    
    SNES_SPC::sample_t* native_buf = (SNES_SPC::sample_t*)malloc(native_samples * sizeof(SNES_SPC::sample_t));
    if (!native_buf) {
        PyMem_Free(output);
        return PyErr_NoMemory();
    }
    
    blargg_err_t err = self->spc->play(native_samples, native_buf);
    if (err) {
        free(native_buf);
        PyMem_Free(output);
        PyErr_Format(PyExc_RuntimeError, "Play failed: %s", err);
        return NULL;
    }
    
    /* Simple linear interpolation resampling */
    int native_idx = 0;
    for (Py_ssize_t i = 0; i < num_samples; i++) {
        double target_idx = i * ratio;
        int idx = (int)target_idx;
        double frac = target_idx - idx;
        
        if (idx >= native_samples / 2 - 1) {
            output[i * out_channels] = self->last_left;
            if (stereo) output[i * out_channels + 1] = self->last_right;
            continue;
        }
        
        SNES_SPC::sample_t left0 = native_buf[idx * 2];
        SNES_SPC::sample_t left1 = native_buf[(idx + 1) * 2];
        SNES_SPC::sample_t right0 = native_buf[idx * 2 + 1];
        SNES_SPC::sample_t right1 = native_buf[(idx + 1) * 2 + 1];
        
        int16_t left = (int16_t)(left0 + frac * (left1 - left0));
        int16_t right = (int16_t)(right0 + frac * (right1 - right0));
        
        output[i * out_channels] = left;
        self->last_left = left;
        if (stereo) {
            output[i * out_channels + 1] = right;
            self->last_right = right;
        }
    }
    
    if (native_samples > 0) {
        self->last_left = native_buf[(native_samples / 2 - 1) * 2];
        self->last_right = native_buf[(native_samples / 2 - 1) * 2 + 1];
    }
    
    free(native_buf);
    
    PyObject* result = PyBytes_FromStringAndSize((const char*)output, buffer_size * sizeof(int16_t));
    PyMem_Free(output);
    return result;
}

/* Load SPC file */
static PyObject* SnesSpc_load_spc(SnesSpc_State* self, PyObject* args) {
    PyObject* bytes_obj;
    if (!PyArg_ParseTuple(args, "O", &bytes_obj))
        return NULL;
    
    Py_buffer view;
    if (PyObject_GetBuffer(bytes_obj, &view, PyBUF_SIMPLE) < 0) {
        return NULL;
    }
    
    if (view.len < 0x10180) {
        PyBuffer_Release(&view);
        PyErr_SetString(PyExc_ValueError, "SPC data too small");
        return NULL;
    }
    
    blargg_err_t err = self->spc->load_spc(view.buf, view.len);
    PyBuffer_Release(&view);
    
    if (err) {
        PyErr_Format(PyExc_RuntimeError, "Load SPC failed: %s", err);
        return NULL;
    }
    
    Py_RETURN_NONE;
}

/* Clear echo */
static PyObject* SnesSpc_clear_echo(SnesSpc_State* self, PyObject* args) {
    self->spc->clear_echo();
    Py_RETURN_NONE;
}

/* Set tempo */
static PyObject* SnesSpc_set_tempo(SnesSpc_State* self, PyObject* args) {
    int tempo;
    if (!PyArg_ParseTuple(args, "i", &tempo))
        return NULL;
    
    self->spc->set_tempo(tempo);
    Py_RETURN_NONE;
}

/* Mute voices */
static PyObject* SnesSpc_mute_voices(SnesSpc_State* self, PyObject* args) {
    int mask;
    if (!PyArg_ParseTuple(args, "i", &mask))
        return NULL;
    
    self->spc->mute_voices(mask);
    Py_RETURN_NONE;
}