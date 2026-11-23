import os
import sys

from setuptools import Extension, setup

# Get the directory of this setup.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Nuked-OPN2 extension
nuked_opn2_ext = Extension(
    'nuked_opn2',
    sources=[
        os.path.join(BASE_DIR, 'nuked_opn2_module.c'),
        os.path.join(BASE_DIR, 'ym3438.c'),
    ],
    include_dirs=[BASE_DIR],
    extra_compile_args=['-std=c99', '-O3'] if sys.platform != 'win32' else ['/std:c11', '/O2'],
    define_macros=[('PY_SSIZE_T_CLEAN', None)],
)

setup(
    name='nuked-opn2',
    version='1.0.0',
    description='Python bindings for Nuked-OPN2 YM3438/YM2612 emulator',
    ext_modules=[nuked_opn2_ext],
    zip_safe=False,
)
