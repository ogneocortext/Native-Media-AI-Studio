# Chip emulator bindings

Own-source glue that sits on top of vendored upstream emulator cores.

Upstream sources (Nuked-OPL3/OPM/OPN2, libresidfp, snes_spc, SameBoy) are
**never committed** — they are fetched at setup time by
`packages/backend/app/adapters/chips/vendor.py` into `tools/<core>/` (those
dirs are gitignored). This directory holds only our own files:

- `setup.py` — setuptools build for the Python C/C++ extension
- `*_module.c` / `*_wrapper.cpp` — Python binding sources
- `*.patch` — local fixes applied to upstream files after vendoring
  (currently `nuked-opn2/ym3438.patch`: the YM2612 EG attack-increment and
  AR=15 instant-attack fixes, decision D76)

`vendor.py` copies everything here into the vendored tree after each clone
and applies any `.patch` files, so a fresh setup reproduces the same build
inputs. To add a binding for a new core, drop files under
`chip-bindings/<core>/` mirroring the upstream-relative paths.
