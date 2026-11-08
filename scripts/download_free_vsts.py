#!/usr/bin/env python3
"""
Free VST3 Plugin Downloader for Native Media AI Studio
Downloads curated free/open-source VST3 plugins for the project.

Usage:
    python scripts/download_free_vsts.py [--list] [--download PLUGIN] [--download-all]
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import requests
from tqdm import tqdm

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent
VST_DIR = PROJECT_ROOT / "assets" / "vst"

# Curated free VST3 plugins with direct download URLs
# These are verified open-source/free plugins with VST3 support
FREE_VSTS = {
    "surge-xt": {
        "name": "Surge XT",
        "type": "Hybrid Synthesizer",
        "description": "Open-source hybrid synth with multiple oscillator types, flexible routing, massive sound design toolkit",
        "source_url": "https://surge-synthesizer.github.io/",
        "repo_url": "https://github.com/surge-synthesizer/surge",
        "releases_url": "https://github.com/surge-synthesizer/surge/releases",
        "download_pattern": "surge-xt-win64-*-pluginsonly.zip",
        "vst3_path_in_zip": "surge-xt-*/Surge.vst3",
        "license": "GPL-3.0",
        "platforms": ["Windows", "macOS", "Linux"],
    },
    "vital": {
        "name": "Vital",
        "type": "Wavetable Synthesizer",
        "description": "Spectral warping wavetable synth with advanced modulation",
        "source_url": "https://vital.audio/",
        "download_url": "https://vital.audio/download/",
        "download_note": "Requires manual download from website (license agreement)",
        "license": "Custom (free for personal/commercial)",
        "platforms": ["Windows", "macOS", "Linux"],
    },
    "dexed": {
        "name": "Dexed",
        "type": "FM Synthesizer (DX7)",
        "description": "Open-source Yamaha DX7 emulation and MIDI cartridge manager",
        "source_url": "https://github.com/asb2m10/dexed",
        "repo_url": "https://github.com/asb2m10/dexed",
        "releases_url": "https://github.com/asb2m10/dexed/releases",
        "download_pattern": "Dexed-*-win.zip",
        "vst3_path_in_zip": "Dexed-*/Dexed.vst3",
        "license": "GPL-3.0",
        "platforms": ["Windows", "macOS", "Linux"],
    },
    "tal-noisemaker": {
        "name": "TAL-NoiseMaker",
        "type": "Virtual Analog Synthesizer",
        "description": "Free virtual analog synth with 128 factory presets, low CPU usage",
        "source_url": "https://tal-software.com/products/tal-noisemaker",
        "download_url": "https://tal-software.com/downloads/tal-noisemaker-win.zip",
        "vst3_path_in_zip": "TAL-NoiseMaker.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
    },
    "tal-reverb-4": {
        "name": "TAL-Reverb-4",
        "type": "Plate Reverb",
        "description": "High-quality plate reverb with modulation",
        "source_url": "https://tal-software.com/products/tal-reverb-4",
        "download_url": "https://tal-software.com/downloads/tal-reverb-4-win.zip",
        "vst3_path_in_zip": "TAL-Reverb-4.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
    },
    "tal-filter-2": {
        "name": "TAL-Filter-2",
        "type": "Filter",
        "description": "Host-synced filter with multiple filter types and modulation",
        "source_url": "https://tal-software.com/products/tal-filter-2",
        "download_url": "https://tal-software.com/downloads/tal-filter-2-win.zip",
        "vst3_path_in_zip": "TAL-Filter-2.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
    },
    "ob-xd": {
        "name": "OB-Xd",
        "type": "Oberheim OB-X Synthesizer",
        "description": "Faithful emulation of the Oberheim OB-X with additional features",
        "source_url": "https://github.com/mkaltner/OB-Xd",
        "download_url": "https://github.com/mkaltner/OB-Xd/releases/download/v1.0.0/OB-Xd-1.0.0-Windows.zip",
        "download_note": "Check releases at https://github.com/mkaltner/OB-Xd/releases for latest Windows zip",
        "vst3_path_in_zip": "OB-Xd-*/OB-Xd.vst3",
        "license": "GPL-3.0",
        "platforms": ["Windows", "macOS", "Linux"],
    },
    "helm": {
        "name": "Helm",
        "type": "Synthesizer",
        "description": "Open-source synth with flexible modulation and cross-platform support",
        "source_url": "https://tytel.org/helm/",
        "download_url": "https://github.com/mtytel/helm/releases/download/v0.9.0/Helm-0.9.0-win64.zip",
        "download_note": "Check releases at https://github.com/mtytel/helm/releases for latest",
        "vst3_path_in_zip": "Helm-*/Helm.vst3",
        "license": "GPL-3.0",
        "platforms": ["Windows", "macOS", "Linux"],
    },
    "tyrelln6": {
        "name": "TyrellN6",
        "type": "Synthesizer",
        "description": "Free virtual analog synth by u-he with great sound and low CPU",
        "source_url": "https://u-he.com/products/tyrelln6/",
        "download_url": "https://u-he.com/downloads/tyrelln6_win.zip",
        "vst3_path_in_zip": "TyrellN6.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
    },
    "zebralette": {
        "name": "Zebralette",
        "type": "Synthesizer",
        "description": "Free spectral synth with advanced wave editor, subset of Zebra2",
        "source_url": "https://u-he.com/products/zebralette/",
        "download_url": "https://u-he.com/downloads/zebralette_win.zip",
        "vst3_path_in_zip": "Zebralette.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
    },
    "span": {
        "name": "Voxengo SPAN",
        "type": "Spectrum Analyzer",
        "description": "Free real-time FFT audio frequency spectrum analyzer",
        "source_url": "https://www.voxengo.com/product/span/",
        "download_url": "https://www.voxengo.com/download/span_v2.zip",
        "vst3_path_in_zip": "span_v2/Span.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
    },
    "tdr-nova": {
        "name": "TDR Nova",
        "type": "Dynamic Equalizer",
        "description": "Parallel dynamic equalizer with 4 bands, spectrum analyzer",
        "source_url": "https://www.tokyodawn.net/tdr-nova/",
        "download_url": "https://www.tokyodawn.net/download/tdr-nova/",
        "vst3_path_in_zip": "TDR Nova.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
    },
    "valhalla-supermassive": {
        "name": "Valhalla Supermassive",
        "type": "Reverb/Delay",
        "description": "Huge reverb and delay with multiple modes, completely free",
        "source_url": "https://valhalladsp.com/shop/reverb/valhalla-supermassive/",
        "download_url": "https://valhalladsp.com/wp-content/uploads/2022/06/ValhallaSupermassive_1_0_1_Win.zip",
        "vst3_path_in_zip": "ValhallaSupermassive.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
    },
    "mfreefxbundle": {
        "name": "MFreeFXBundle",
        "type": "Effects Bundle",
        "description": "37 free effects including EQ, compression, reverb, delay, modulation",
        "source_url": "https://www.meldaproduction.com/MFreeFXBundle",
        "download_url": "https://www.meldaproduction.com/download.php?product=MFreeFXBundle",
        "vst3_path_in_zip": "MFreeFXBundle/*.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
    },
}

# Additional plugins that require manual download (license restrictions)
MANUAL_DOWNLOAD = {
    "vital": "Requires accepting license agreement on vital.audio",
    "vitalium": "Community fork of Vital, open-source: https://github.com/Vitalium/Vitalium",
    "airwindows": "Many free plugins: https://www.airwindows.com/",
    "kjaerhus": "Classic free plugins: http://www.kjaerhus.com/",
    "dssi": "Various free plugins: https://dssi.sourceforge.net/",
}


def print_available():
    """Print all available plugins"""
    print("\n" + "=" * 80)
    print("FREE VST3 PLUGINS FOR NATIVE MEDIA AI STUDIO")
    print("=" * 80)
    print(f"\nTotal automated: {len(FREE_VSTS)}")
    print(f"Manual download: {len(MANUAL_DOWNLOAD)}")
    print("\nAUTOMATED DOWNLOADS:")
    print("-" * 80)
    for key, info in FREE_VSTS.items():
        print(f"\n  {info['name']} ({key})")
        print(f"    Type: {info['type']}")
        print(f"    Description: {info['description']}")
        print(f"    License: {info['license']}")
        print(f"    Platforms: {', '.join(info['platforms'])}")
        print(f"    Source: {info['source_url']}")

    print("\nMANUAL DOWNLOAD REQUIRED:")
    print("-" * 80)
    for key, note in MANUAL_DOWNLOAD.items():
        print(f"\n  {key}: {note}")

    print("\n" + "=" * 80)


def fetch_github_latest_release(repo_url: str, pattern: str) -> str | None:
    """Fetch latest release asset URL from GitHub matching pattern"""
    try:
        api_url = repo_url.replace("github.com", "api.github.com/repos") + "/releases/latest"
        headers = {"Accept": "application/vnd.github.v3+json"}
        response = requests.get(api_url, headers=headers, timeout=30)
        if response.status_code != 200:
            return None

        data = response.json()
        import fnmatch
        for asset in data.get("assets", []):
            name = asset.get("name", "")
            if fnmatch.fnmatch(name.lower(), pattern.lower()):
                return asset.get("browser_download_url")
    except Exception as e:
        print(f"  Error fetching GitHub release: {e}")
    return None


def download_file(url: str, dest: Path, desc: str = "Downloading") -> bool:
    """Download file with progress bar"""
    try:
        response = requests.get(url, stream=True, timeout=60)
        response.raise_for_status()

        total_size = int(response.headers.get("content-length", 0))
        with open(dest, "wb") as f, tqdm(
            total=total_size, unit="B", unit_scale=True, desc=desc
        ) as pbar:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    pbar.update(len(chunk))
        return True
    except Exception as e:
        print(f"  Error downloading: {e}")
        return False


def extract_zip(zip_path: Path, extract_to: Path, vst3_pattern: str) -> list[Path]:
    """Extract VST3 from zip file"""
    extracted = []
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            # Find VST3 files
            for member in zf.namelist():
                if member.endswith(".vst3/") or ".vst3" in member:
                    # Extract the entire VST3 directory
                    zf.extract(member, extract_to)
                    extracted_path = extract_to / member
                    if extracted_path.exists():
                        extracted.append(extracted_path)

            # Also extract all if pattern matches
            if not extracted:
                zf.extractall(extract_to)
                # Search for VST3
                for vst3 in extract_to.rglob("*.vst3"):
                    extracted.append(vst3)

    except Exception as e:
        print(f"  Error extracting: {e}")
    return extracted


def install_vst3(source_vst3: Path, plugin_name: str) -> bool:
    """Install VST3 to project assets/vst directory"""
    try:
        dest = VST_DIR / f"{plugin_name}.vst3"
        if dest.exists():
            shutil.rmtree(dest)
        if source_vst3.is_dir():
            shutil.copytree(source_vst3, dest)
        else:
            # If it's a file, create directory structure
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_vst3, dest / source_vst3.name)
        print(f"  Installed to: {dest}")
        return True
    except Exception as e:
        print(f"  Error installing: {e}")
        return False


def download_and_install(key: str, info: dict) -> bool:
    """Download and install a single plugin"""
    print(f"\n{'='*60}")
    print(f"Processing: {info['name']} ({key})")
    print(f"{'='*60}")

    # Check if already installed
    existing = VST_DIR / f"{key}.vst3"
    if existing.exists():
        print(f"  Already installed at {existing}")
        return True

    # Handle manual download plugins
    if "download_note" in info:
        print(f"  MANUAL DOWNLOAD REQUIRED: {info['download_note']}")
        print(f"  Visit: {info['source_url']}")
        return False

    download_url = None

    # Try GitHub releases first (if repo_url is present)
    if "repo_url" in info and "download_pattern" in info:
        print(f"  Checking GitHub releases...")
        download_url = fetch_github_latest_release(info["repo_url"], info["download_pattern"])

    # Fall back to direct download URL
    if not download_url and "download_url" in info:
        download_url = info["download_url"]

    if not download_url:
        print(f"  No download URL available")
        return False

    # Download
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        zip_path = tmpdir / f"{key}.zip"

        print(f"  Downloading from: {download_url}")
        if not download_file(download_url, zip_path, f"Downloading {info['name']}"):
            return False

        # Extract
        print(f"  Extracting...")
        extracted = extract_zip(zip_path, tmpdir, ".vst3")

        # Find VST3
        vst3_path = None
        for path in extracted:
            if path.name.endswith(".vst3") and path.is_dir():
                vst3_path = path
                break
            elif path.name.endswith(".vst3") and path.is_file():
                # Create directory structure for file
                vst3_dir = tmpdir / f"{key}.vst3"
                vst3_dir.mkdir(parents=True)
                shutil.copy2(path, vst3_dir / path.name)
                vst3_path = vst3_dir
                break

        if not vst3_path:
            # Search more broadly
            for vst3 in tmpdir.rglob("*.vst3"):
                if vst3.is_dir():
                    vst3_path = vst3
                    break

        if not vst3_path:
            print(f"  Could not find VST3 in extracted files")
            return False

        # Install
        print(f"  Installing...")
        if install_vst3(vst3_path, key):
            print(f"  ✓ Successfully installed {info['name']}")
            return True

    return False


def main():
    parser = argparse.ArgumentParser(description="Free VST3 Plugin Downloader")
    parser.add_argument("--list", action="store_true", help="List all available plugins")
    parser.add_argument("--download", type=str, help="Download specific plugin by key")
    parser.add_argument("--download-all", action="store_true", help="Download all automated plugins")
    parser.add_argument("--force", action="store_true", help="Force re-download even if installed")

    args = parser.parse_args()

    # Ensure VST directory exists
    VST_DIR.mkdir(parents=True, exist_ok=True)

    if args.list:
        print_available()
        return

    if args.download:
        if args.download in FREE_VSTS:
            if args.force:
                existing = VST_DIR / f"{args.download}.vst3"
                if existing.exists():
                    shutil.rmtree(existing)
            download_and_install(args.download, FREE_VSTS[args.download])
        else:
            print(f"Unknown plugin: {args.download}")
            print("Use --list to see available plugins")
        return

    if args.download_all:
        print(f"Downloading {len(FREE_VSTS)} plugins...")
        success = 0
        failed = 0
        for key, info in FREE_VSTS.items():
            if download_and_install(key, info):
                success += 1
            else:
                failed += 1
        print(f"\n{'='*60}")
        print(f"Results: {success} succeeded, {failed} failed")
        print(f"{'='*60}")
        return

    # Default: show help
    parser.print_help()


if __name__ == "__main__":
    main()