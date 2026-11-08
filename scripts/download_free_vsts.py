#!/usr/bin/env python3
"""
Free VST3 Plugin Downloader for Native Media AI Studio
Downloads curated free/open-source VST3 plugins for the project.

Usage:
    python scripts/download_free_vsts.py [--list] [--download PLUGIN] [--download-all]
"""

import argparse
import os
import shutil
import subprocess
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
        "status": "auto",
    },
    "dexed": {
        "name": "Dexed",
        "type": "FM Synthesizer (DX7)",
        "description": "Open-source Yamaha DX7 emulation and MIDI cartridge manager",
        "source_url": "https://github.com/asb2m10/dexed",
        "repo_url": "https://github.com/asb2m10/dexed",
        "releases_url": "https://github.com/asb2m10/dexed/releases",
        "download_url": "https://github.com/asb2m10/dexed/releases/download/v1.1.0/Dexed-1.1.0-win.zip",
        "download_note": "GitHub downloads may time out; manual download from https://github.com/asb2m10/dexed/releases",
        "vst3_path_in_zip": "Dexed.vst3",
        "license": "GPL-3.0",
        "platforms": ["Windows", "macOS", "Linux"],
        "status": "manual",
    },
    "ob-xd": {
        "name": "OB-Xd",
        "type": "Oberheim OB-X Synthesizer",
        "description": "Faithful emulation of the Oberheim OB-X with additional features",
        "source_url": "https://github.com/reales/OB-Xd",
        "download_url": "https://github.com/reales/OB-Xd/releases/download/v2.20/Obxd220.exe",
        "download_note": "GitHub downloads may time out; manual download from https://github.com/reales/OB-Xd/releases",
        "vst3_path_in_zip": "OB-Xd.vst3",
        "license": "GPL-3.0",
        "platforms": ["Windows", "macOS", "Linux"],
        "status": "manual",
        "note": "Windows installer (.exe) - run silently with /S flag",
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
        "status": "manual",
    },
    "tal-noisemaker": {
        "name": "TAL-NoiseMaker",
        "type": "Virtual Analog Synthesizer",
        "description": "Free virtual analog synth with 128 factory presets, low CPU usage",
        "source_url": "https://tal-software.com/products/tal-noisemaker",
        "download_url": "https://tal-software.com/downloads/tal-noisemaker-win.zip",
        "download_note": "TAL website URLs may have changed; manual download from https://tal-software.com/products/tal-noisemaker",
        "vst3_path_in_zip": "TAL-NoiseMaker.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
        "status": "manual",
    },
    "tal-reverb-4": {
        "name": "TAL-Reverb-4",
        "type": "Plate Reverb",
        "description": "High-quality plate reverb with modulation",
        "source_url": "https://tal-software.com/products/tal-reverb-4",
        "download_url": "https://tal-software.com/downloads/tal-reverb-4-win.zip",
        "download_note": "TAL website URLs may have changed; manual download from https://tal-software.com/products/tal-reverb-4",
        "vst3_path_in_zip": "TAL-Reverb-4.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
        "status": "manual",
    },
    "tal-filter-2": {
        "name": "TAL-Filter-2",
        "type": "Filter",
        "description": "Host-synced filter with multiple filter types and modulation",
        "source_url": "https://tal-software.com/products/tal-filter-2",
        "download_url": "https://tal-software.com/downloads/tal-filter-2-win.zip",
        "download_note": "TAL website URLs may have changed; manual download from https://tal-software.com/products/tal-filter-2",
        "vst3_path_in_zip": "TAL-Filter-2.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
        "status": "manual",
    },
    "helm": {
        "name": "Helm",
        "type": "Synthesizer",
        "description": "Open-source synth with flexible modulation and cross-platform support",
        "source_url": "https://tytel.org/helm/",
        "download_url": "https://github.com/mtytel/helm/releases/download/v0.9.0/Helm-0.9.0-win64.zip",
        "download_note": "GitHub releases have no assets; manual download from https://tytel.org/helm/",
        "vst3_path_in_zip": "Helm-*/Helm.vst3",
        "license": "GPL-3.0",
        "platforms": ["Windows", "macOS", "Linux"],
        "status": "manual",
    },
    "tyrelln6": {
        "name": "TyrellN6",
        "type": "Synthesizer",
        "description": "Free virtual analog synth by u-he with great sound and low CPU",
        "source_url": "https://u-he.com/products/tyrelln6/",
        "download_url": "https://u-he.com/downloads/tyrelln6_win.zip",
        "download_note": "u-he URLs may have changed; manual download from https://u-he.com/products/tyrelln6/",
        "vst3_path_in_zip": "TyrellN6.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
        "status": "manual",
    },
    "zebralette": {
        "name": "Zebralette",
        "type": "Synthesizer",
        "description": "Free spectral synth with advanced wave editor, subset of Zebra2",
        "source_url": "https://u-he.com/products/zebralette/",
        "download_url": "https://u-he.com/downloads/zebralette_win.zip",
        "download_note": "u-he URLs may have changed; manual download from https://u-he.com/products/zebralette/",
        "vst3_path_in_zip": "Zebralette.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
        "status": "manual",
    },
    "span": {
        "name": "Voxengo SPAN",
        "type": "Spectrum Analyzer",
        "description": "Free real-time FFT audio frequency spectrum analyzer",
        "source_url": "https://www.voxengo.com/product/span/",
        "download_url": "https://www.voxengo.com/download/span_v2_win.zip",
        "download_note": "Voxengo URLs may have changed; manual download from https://www.voxengo.com/product/span/",
        "vst3_path_in_zip": "span_v2/Span.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
        "status": "manual",
    },
    "tdr-nova": {
        "name": "TDR Nova",
        "type": "Dynamic Equalizer",
        "description": "Parallel dynamic equalizer with 4 bands, spectrum analyzer",
        "source_url": "https://www.tokyodawn.net/tdr-nova/",
        "download_url": "https://www.tokyodawn.net/download/tdr-nova-win.zip",
        "download_note": "TDR website URLs may have changed; manual download from https://www.tokyodawn.net/tdr-nova/",
        "vst3_path_in_zip": "TDR Nova.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
        "status": "manual",
    },
    "valhalla-supermassive": {
        "name": "Valhalla Supermassive",
        "type": "Reverb/Delay",
        "description": "Huge reverb and delay with multiple modes, completely free",
        "source_url": "https://valhalladsp.com/shop/reverb/valhalla-supermassive/",
        "download_url": "https://valhalladsp.com/wp-content/uploads/2022/06/ValhallaSupermassive_1_0_1_Win.zip",
        "download_note": "Valhalla DSP direct download may require referrer; manual download from https://valhalladsp.com/shop/reverb/valhalla-supermassive/",
        "vst3_path_in_zip": "ValhallaSupermassive.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
        "status": "manual",
    },
    "mfreefxbundle": {
        "name": "MFreeFXBundle",
        "type": "Effects Bundle",
        "description": "37 free effects including EQ, compression, reverb, delay, modulation",
        "source_url": "https://www.meldaproduction.com/MFreeFXBundle",
        "download_url": "https://www.meldaproduction.com/download.php?product=MFreeFXBundle&format=win64",
        "download_note": "MeldaProduction requires account/login; manual download from https://www.meldaproduction.com/MFreeFXBundle",
        "vst3_path_in_zip": "MFreeFXBundle/*.vst3",
        "license": "Free",
        "platforms": ["Windows", "macOS"],
        "status": "manual",
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
    
    auto_count = sum(1 for info in FREE_VSTS.values() if info.get("status", "auto") == "auto")
    manual_count = sum(1 for info in FREE_VSTS.values() if info.get("status", "auto") == "manual")
    installer_count = sum(1 for info in FREE_VSTS.values() if info.get("status", "auto") == "installer")
    
    print(f"\nAutomated (zip): {auto_count}")
    print(f"Installer (.exe): {installer_count}")
    print(f"Manual download: {manual_count}")
    
    print("\nAUTOMATED DOWNLOADS (zip):")
    print("-" * 80)
    for key, info in FREE_VSTS.items():
        if info.get("status", "auto") == "auto":
            print(f"\n  {info['name']} ({key})")
            print(f"    Type: {info['type']}")
            print(f"    Description: {info['description']}")
            print(f"    License: {info['license']}")
            print(f"    Platforms: {', '.join(info['platforms'])}")
            print(f"    Source: {info['source_url']}")

    print("\nINSTALLER (.exe - needs silent install):")
    print("-" * 80)
    for key, info in FREE_VSTS.items():
        if info.get("status", "auto") == "installer":
            print(f"\n  {info['name']} ({key})")
            print(f"    Type: {info['type']}")
            print(f"    Description: {info['description']}")
            print(f"    License: {info['license']}")
            print(f"    Platforms: {', '.join(info['platforms'])}")
            print(f"    Source: {info['source_url']}")
            if "note" in info:
                print(f"    Note: {info['note']}")

    print("\nMANUAL DOWNLOAD REQUIRED:")
    print("-" * 80)
    for key, info in FREE_VSTS.items():
        if info.get("status", "auto") == "manual":
            print(f"\n  {info['name']} ({key})")
            print(f"    Type: {info['type']}")
            print(f"    Description: {info['description']}")
            print(f"    License: {info['license']}")
            print(f"    Platforms: {', '.join(info['platforms'])}")
            print(f"    Source: {info['source_url']}")
            if "download_note" in info:
                print(f"    Note: {info['download_note']}")
            print(f"    Download: {info.get('download_url', info.get('source_url', 'N/A'))}")

    print("\nADDITIONAL MANUAL DOWNLOADS (license restrictions):")
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


def run_installer_silently(exe_path: Path) -> bool:
    """Run Windows installer silently to extract VST3"""
    try:
        # Try common silent install flags
        for flags in [["/S"], ["/quiet"], ["/qn"], ["--silent"], ["-s"]]:
            print(f"  Trying silent install with flags: {flags}")
            result = subprocess.run(
                [str(exe_path)] + flags,
                capture_output=True,
                timeout=120
            )
            if result.returncode == 0:
                print(f"  Installer succeeded with flags: {flags}")
                return True
        print(f"  All silent install attempts failed")
        return False
    except Exception as e:
        print(f"  Error running installer: {e}")
        return False


def find_vst3_in_program_files(plugin_name: str) -> list[Path]:
    """Search common VST3 locations for installed plugin"""
    found = []
    common_paths = [
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "Common Files" / "VST3",
        Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")) / "Common Files" / "VST3",
        Path(os.environ.get("CommonProgramFiles", "C:\\Program Files\\Common Files")) / "VST3",
        Path(os.environ.get("CommonProgramFiles(x86)", "C:\\Program Files (x86)\\Common Files")) / "VST3",
    ]
    for path in common_paths:
        if path.exists():
            for vst3 in path.rglob(f"*{plugin_name}*.vst3"):
                if vst3.is_dir():
                    return [vst3]
    return []


def download_and_install(key: str, info: dict) -> bool:
    """Download and install a single plugin"""
    print(f"\n{'=' * 60}")
    print(f"Processing: {info['name']} ({key})")
    print(f"{'=' * 60}")

    # Check if already installed
    existing = VST_DIR / f"{key}.vst3"
    if existing.exists():
        print(f"  Already installed at {existing}")
        return True

    status = info.get("status", "auto")

    if status == "manual":
        print(f"  MANUAL DOWNLOAD REQUIRED: {info.get('download_note', 'See website')}")
        print(f"  Visit: {info['source_url']}")
        return False

    download_url = None

    # Try GitHub releases first (if repo_url is present)
    if "repo_url" in info and "download_pattern" in info:
        print("  Checking GitHub releases...")
        download_url = fetch_github_latest_release(info["repo_url"], info["download_pattern"])

    # Fall back to direct download URL
    if not download_url and "download_url" in info:
        download_url = info["download_url"]

    if not download_url:
        print("  No download URL available")
        return False

    # Download
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)

        # Determine file extension from URL
        parsed = urlparse(download_url)
        filename = os.path.basename(parsed.path)
        if not filename or '.' not in filename:
            filename = f"{key}.zip"

        download_path = tmpdir / filename

        print(f"  Downloading from: {download_url}")
        if not download_file(download_url, download_path, f"Downloading {info['name']}"):
            return False

        # Handle based on file type
        if download_path.suffix.lower() == '.exe':
            # It's an installer
            print(f"  Running installer silently...")
            if run_installer_silently(download_path):
                # Search for VST3 in common locations
                print(f"  Searching for installed VST3...")
                found = find_vst3_in_program_files(info['name'].replace(' ', ''))
                if found:
                    return install_vst3(found[0], key)
                else:
                    print(f"  VST3 not found in standard locations after install")
                    return False
            else:
                print(f"  Silent install failed")
                return False
        else:
            # Assume zip file
            print(f"  Extracting...")
            extracted = extract_zip(download_path, tmpdir, ".vst3")

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
        print(f"\n{'=' * 60}")
        print(f"Results: {success} succeeded, {failed} failed")
        print(f"{'=' * 60}")
        return

    # Default: show help
    parser.print_help()


if __name__ == "__main__":
    main()
