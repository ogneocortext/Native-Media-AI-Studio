import os
import sys

from setuptools import Extension, setup

# Get the directory of this setup.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Nuked-OPL3 extension
nuked_opl3_ext = Extension(
    'nuked_opl3',
    sources=[
        os.path.join(BASE_DIR, 'nuked_opl3_module.c'),
        os.path.join(BASE_DIR, 'opl3.c'),
    ],
    include_dirs=[BASE_DIR],
    extra_compile_args=['-std=c99', '-O3'] if sys.platform != 'win32' else ['/std:c11', '/O2'],
    define_macros=[('PY_SSIZE_T_CLEAN', None)],
)

setup(
    name='nuked-opl3',
    version='1.0.0',
    description='Python bindings for Nuked-OPL3 YMF262/OPL2/OPL3 emulator',
    ext_modules=[nuked_opl3_ext],
    zip_safe=False,
)
