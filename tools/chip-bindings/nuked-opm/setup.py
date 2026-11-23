import os
import sys

from setuptools import Extension, setup

# Get the directory of this setup.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Nuked-OPM extension
nuked_opm_ext = Extension(
    'nuked_opm',
    sources=[
        os.path.join(BASE_DIR, 'nuked_opm_module.c'),
        os.path.join(BASE_DIR, 'opm.c'),
    ],
    include_dirs=[BASE_DIR],
    extra_compile_args=['-std=c99', '-O3'] if sys.platform != 'win32' else ['/std:c11', '/O2'],
    define_macros=[('PY_SSIZE_T_CLEAN', None)],
)

setup(
    name='nuked-opm',
    version='1.0.0',
    description='Python bindings for Nuked-OPM YM2151/YM2164 emulator',
    ext_modules=[nuked_opm_ext],
    zip_safe=False,
)
