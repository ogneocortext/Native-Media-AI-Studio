import os
import sys

from setuptools import Extension, setup

# Get the directory of this setup.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# libresidfp extension - include all C++ sources
residfp_sources = [
    os.path.join(BASE_DIR, 'residfp_module.cpp'),
    os.path.join(BASE_DIR, 'residfp_wrapper.cpp'),
    # Core SID files (in src/)
    os.path.join(BASE_DIR, 'src', 'SID.cpp'),
    os.path.join(BASE_DIR, 'src', 'WaveformGenerator.cpp'),
    os.path.join(BASE_DIR, 'src', 'WaveformCalculator.cpp'),
    os.path.join(BASE_DIR, 'src', 'EnvelopeGenerator.cpp'),
    os.path.join(BASE_DIR, 'src', 'Filter.cpp'),
    os.path.join(BASE_DIR, 'src', 'Filter6581.cpp'),
    os.path.join(BASE_DIR, 'src', 'Filter8580.cpp'),
    os.path.join(BASE_DIR, 'src', 'FilterModelConfig.cpp'),
    os.path.join(BASE_DIR, 'src', 'FilterModelConfig6581.cpp'),
    os.path.join(BASE_DIR, 'src', 'FilterModelConfig8580.cpp'),
    os.path.join(BASE_DIR, 'src', 'Dac.cpp'),
    os.path.join(BASE_DIR, 'src', 'OpAmp.cpp'),
    os.path.join(BASE_DIR, 'src', 'ExternalFilter.cpp'),
    os.path.join(BASE_DIR, 'src', 'Integrator6581.cpp'),
    os.path.join(BASE_DIR, 'src', 'Integrator8580.cpp'),
    os.path.join(BASE_DIR, 'src', 'Spline.cpp'),
    os.path.join(BASE_DIR, 'src', 'State.cpp'),
    os.path.join(BASE_DIR, 'src', 'version.cc'),
    # Residfp core (in src/residfp/)
    os.path.join(BASE_DIR, 'src', 'residfp', 'residfp.cpp'),
    # Resample (in src/resample/)
    os.path.join(BASE_DIR, 'src', 'resample', 'SincResampler.cpp'),
]

residfp_ext = Extension(
    'residfp',
    sources=residfp_sources,
    include_dirs=[
        BASE_DIR,
        os.path.join(BASE_DIR, 'src'),
        os.path.join(BASE_DIR, 'src', 'residfp'),
        os.path.join(BASE_DIR, 'src', 'resample'),
    ],
    extra_compile_args=['-std=c++11', '-O3', '-fPIC'] if sys.platform != 'win32' else ['/std:c++14', '/O2', '/EHsc'],
    define_macros=[('PY_SSIZE_T_CLEAN', None), ('RESIDFP_EXTERN', '')],
    language='c++',
)

setup(
    name='residfp',
    version='1.0.0',
    description='Python bindings for libresidfp SID 6581/8580 emulator',
    ext_modules=[residfp_ext],
    zip_safe=False,
)
