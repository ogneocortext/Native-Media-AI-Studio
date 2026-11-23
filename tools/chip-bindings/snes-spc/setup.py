import os
import sys

from setuptools import Extension, setup

# Get the directory of this setup.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# snes-spc extension
snes_spc_ext = Extension(
    'snes_spc',
    sources=[
        os.path.join(BASE_DIR, 'snes_spc_module.cpp'),
        os.path.join(BASE_DIR, 'snes_spc', 'SNES_SPC.cpp'),
        os.path.join(BASE_DIR, 'snes_spc', 'SNES_SPC_state.cpp'),
        os.path.join(BASE_DIR, 'snes_spc', 'SNES_SPC_misc.cpp'),
        os.path.join(BASE_DIR, 'snes_spc', 'SPC_DSP.cpp'),
        os.path.join(BASE_DIR, 'snes_spc', 'SPC_Filter.cpp'),
        os.path.join(BASE_DIR, 'snes_spc', 'dsp.cpp'),
        os.path.join(BASE_DIR, 'snes_spc', 'spc.cpp'),
    ],
    include_dirs=[
        BASE_DIR,
        os.path.join(BASE_DIR, 'snes_spc'),
    ],
    extra_compile_args=['-std=c++11', '-O3', '-fPIC'] if sys.platform != 'win32' else ['/std:c++14', '/O2', '/EHsc'],
    define_macros=[('PY_SSIZE_T_CLEAN', None)],
    language='c++',
)

setup(
    name='snes-spc',
    version='1.0.0',
    description='Python bindings for snes-spc SPC700 emulator',
    ext_modules=[snes_spc_ext],
    zip_safe=False,
)
