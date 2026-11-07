"""
Upstream Chip Emulator Versions

This file tracks the exact upstream versions used for each adapter.
When updating, change the version here and run the vendor script.
"""

UPSTREAM_VERSIONS = {
    "nuked-opn2": {
        "repo": "https://github.com/nukeykt/Nuked-OPN2",
        "version": "1.0.12",
        "commit": "v1.0.12",
        "license": "LGPL-2.1",
        "local_path": "tools/nuked-opn2",
    },
    "nuked-opm": {
        "repo": "https://github.com/nukeykt/Nuked-OPM",
        "version": "1.0.0",
        "commit": "main",
        "license": "LGPL-2.1",
        "local_path": "tools/nuked-opm",
    },
    "nuked-opl3": {
        "repo": "https://github.com/nukeykt/Nuked-OPL3",
        "version": "1.0.0",
        "commit": "main",
        "license": "LGPL-2.1",
        "local_path": "tools/nuked-opl3",
    },
    "residfp": {
        "repo": "https://github.com/libsidplayfp/libresidfp",
        "version": "1.3.0",
        "commit": "main",
        "license": "GPL-2.0",
        "local_path": "tools/residfp",
    },
    "snes-spc": {
        "repo": "https://github.com/blarggs-audio-libraries/snes_spc",
        "version": "2024-01-01",
        "commit": "main",
        "license": "BSD-2-Clause",
        "local_path": "tools/snes-spc",
    },
    "sameboy": {
        "repo": "https://github.com/LIJI32/SameBoy",
        "version": "1.0.0",
        "commit": "main",
        "license": "MIT",
        "local_path": "tools/sameboy",
    },
}


def get_version(core: str) -> dict:
    """Get version info for a core."""
    return UPSTREAM_VERSIONS.get(core, {})


def list_cores() -> list:
    """List all tracked cores."""
    return list(UPSTREAM_VERSIONS.keys())