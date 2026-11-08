"""
VST Host Service for AI Agent Music Creation
Supports loading VST3 plugins, chaining effects, and processing audio through plugin chains.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml
from pedalboard import Pedalboard, load_plugin
from pedalboard.io import AudioFile

if TYPE_CHECKING:
    import numpy as np

logger = logging.getLogger(__name__)

# Load VST configuration from YAML
CONFIG_PATH = Path(__file__).resolve().parent.parent.parent.parent.parent / "config" / "vst_config.yaml"


def load_vst_config() -> dict:
    """Load VST configuration from YAML file."""
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except Exception as e:
        logger.warning(f"Failed to load VST config from {CONFIG_PATH}: {e}")
        return {}


# Load configuration
VST_CONFIG = load_vst_config()


# Build VST search paths from config
def get_vst_paths() -> list[Path]:
    """Get VST search paths from config, with fallback to defaults."""
    paths = []
    project_root = Path(__file__).resolve().parent.parent.parent.parent.parent

    # Add paths from config
    if "vst_paths" in VST_CONFIG:
        for path_str in VST_CONFIG["vst_paths"]:
            # Handle project-relative paths
            if path_str.startswith("assets/"):
                expanded = project_root / path_str
            else:
                # Expand environment variables and user home
                expanded = os.path.expandvars(os.path.expanduser(path_str))
            paths.append(Path(expanded))
    else:
        # Fallback defaults
        paths.extend([
            project_root / "assets" / "vst",
            Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "VST3",
            Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")) / "VST3",
            Path(os.environ.get("CommonProgramFiles", "C:\\Program Files\\Common Files")) / "VST3",
            Path(os.environ.get("CommonProgramFiles(x86)", "C:\\Program Files (x86)\\Common Files")) / "VST3",
            Path.home() / "Documents" / "VST3",
            Path("C:\\VST3"),
            Path("C:\\Program Files\\VST3"),
            Path("C:\\Program Files (x86)\\VST3"),
        ])

    return paths


# Project VST directory
PROJECT_VST_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent / "assets" / "vst"
PROJECT_VST_DIR.mkdir(parents=True, exist_ok=True)

# VST search paths
DEFAULT_VST_PATHS = get_vst_paths()

# Known plugins from config
KNOWN_PLUGINS = VST_CONFIG.get("known_plugins", [])


@dataclass
class VSTPluginInfo:
    """Information about a discovered VST plugin."""
    name: str
    path: str
    vendor: str = ""
    version: str = ""
    category: str = "effect"  # effect, instrument, midi
    num_inputs: int = 2
    num_outputs: int = 2
    parameters: list[dict[str, Any]] = field(default_factory=list)
    is_valid: bool = True
    error_message: str = ""


@dataclass
class VSTChain:
    """A chain of VST plugins for processing."""
    name: str
    plugins: list[dict[str, Any]] = field(default_factory=list)  # plugin info + parameter values
    sample_rate: int = 44100
    block_size: int = 512


@dataclass
class VSTPreset:
    """Preset for a VST plugin."""
    plugin_name: str
    name: str
    parameters: dict[str, float]


class VSTHost:
    """Main VST host service for loading and processing with VST plugins."""

    def __init__(self, vst_paths: list[Path] | None = None):
        self.vst_paths = vst_paths or DEFAULT_VST_PATHS
        self.plugins: dict[str, VSTPluginInfo] = {}
        self.chains: dict[str, VSTChain] = {}
        self.presets: dict[str, list[VSTPreset]] = {}
        self._pedalboard_cache: dict[str, Pedalboard] = {}

    def scan_vst_plugins(self) -> list[VSTPluginInfo]:
        """Scan all VST paths for plugins."""
        logger.info("Scanning for VST3 plugins...")
        found_plugins = []

        for vst_path in self.vst_paths:
            if not vst_path.exists():
                continue

            for plugin_file in vst_path.rglob("*.vst3"):
                # VST3 plugins on Windows can be directories OR files (junction points)
                # Check both is_dir() and is_file() since Windows sometimes reports them as files
                if plugin_file.is_dir() or plugin_file.is_file():
                    plugin_info = self._analyze_plugin(plugin_file)
                    if plugin_info:
                        found_plugins.append(plugin_info)
                        self.plugins[plugin_info.name] = plugin_info

        logger.info(f"Found {len(found_plugins)} VST3 plugins")
        return found_plugins

    def _analyze_plugin(self, plugin_path: Path) -> VSTPluginInfo | None:
        """Analyze a VST3 plugin directory."""
        try:
            # Try to load the plugin to get metadata
            plugin = load_plugin(str(plugin_path))

            # Check if load_plugin returned a valid plugin object
            if not hasattr(plugin, 'name') or not hasattr(plugin, 'parameters'):
                logger.warning(f"Plugin at {plugin_path} returned invalid object: {type(plugin)}")
                return VSTPluginInfo(
                    name=plugin_path.name,
                    path=str(plugin_path),
                    is_valid=False,
                    error_message=f"Invalid plugin object: {type(plugin)}",
                )

            # Get parameter info
            parameters = []
            for _param_name, param in plugin.parameters.items():
                # pedalboard parameter objects have different attribute names
                # Handle missing attributes gracefully with defaults
                default_val = getattr(param, 'default_raw_value', getattr(param, 'raw_value', None))
                min_val = getattr(param, 'min_value', None)
                max_val = getattr(param, 'max_value', None)
                unit_val = getattr(param, 'label', '') if hasattr(param, 'label') else ''

                # Provide defaults for required fields
                parameters.append({
                    "name": getattr(param, 'name', 'unknown'),
                    "min": min_val if min_val is not None else 0.0,
                    "max": max_val if max_val is not None else 1.0,
                    "default": default_val if default_val is not None else 0.0,
                    "unit": unit_val or '',
                })

            return VSTPluginInfo(
                name=plugin.name,
                path=str(plugin_path),
                vendor=getattr(plugin, 'vendor', ''),
                version=getattr(plugin, 'version', ''),
                category=self._guess_category(plugin),
                num_inputs=getattr(plugin, 'num_inputs', 2),
                num_outputs=getattr(plugin, 'num_outputs', 2),
                parameters=parameters,
                is_valid=True,
            )
        except Exception as e:
            logger.warning(f"Failed to load plugin at {plugin_path}: {e}")
            return VSTPluginInfo(
                name=plugin_path.name,
                path=str(plugin_path),
                is_valid=False,
                error_message=str(e),
            )

    def _guess_category(self, plugin) -> str:
        """Guess plugin category based on name and parameters."""
        name_lower = plugin.name.lower()
        if any(kw in name_lower for kw in ['synth', 'instrument', 'piano', 'drum', 'sampler']):
            return "instrument"
        elif any(kw in name_lower for kw in ['midi', 'arpeggiator', 'sequencer']):
            return "midi"
        return "effect"

    def load_plugin(self, plugin_name: str) -> Any:
        """Load a VST plugin by name."""
        if plugin_name not in self.plugins:
            raise ValueError(f"Plugin not found: {plugin_name}")

        plugin_info = self.plugins[plugin_name]
        if not plugin_info.is_valid:
            raise ValueError(f"Plugin is not valid: {plugin_info.error_message}")

        return load_plugin(plugin_info.path)

    def create_pedalboard(self, chain: VSTChain) -> Pedalboard:
        """Create a Pedalboard from a VST chain."""
        cache_key = f"{chain.name}_{json.dumps(chain.plugins, sort_keys=True)}"

        if cache_key in self._pedalboard_cache:
            return self._pedalboard_cache[cache_key]

        board = Pedalboard()

        for plugin_data in chain.plugins:
            plugin_name = plugin_data["name"]
            plugin = self.load_plugin(plugin_name)

            # Set parameter values
            for param_name, value in plugin_data.get("parameters", {}).items():
                try:
                    param = next(p for p in plugin.parameters.values() if p.name == param_name)
                    param.value = value
                except StopIteration:
                    logger.warning(f"Parameter {param_name} not found in {plugin_name}")

            board.append(plugin)

        self._pedalboard_cache[cache_key] = board
        return board

    def process_audio(self, chain_name: str, input_audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """Process audio through a VST chain."""
        if chain_name not in self.chains:
            raise ValueError(f"Chain not found: {chain_name}")

        chain = self.chains[chain_name]
        board = self.create_pedalboard(chain)

        # Process audio
        output = board(input_audio, sample_rate)
        return output

    def process_file(self, chain_name: str, input_path: Path, output_path: Path) -> dict:
        """Process an audio file through a VST chain."""
        # Convert Path to string for pedalboard compatibility on Windows
        input_path_str = str(input_path)
        output_path_str = str(output_path)

        with AudioFile(input_path_str) as f:
            audio = f.read(f.frames)
            sr = f.samplerate

        # Convert to mono if needed for processing
        if audio.shape[0] > 2:
            audio = audio[:2]  # Take first 2 channels

        output = self.process_audio(chain_name, audio, sr)

        with AudioFile(output_path_str, 'w', sr, output.shape[0]) as f:
            f.write(output)

        return {
            "input_path": str(input_path),
            "output_path": str(output_path),
            "sample_rate": sr,
            "duration": len(audio[0]) / sr,
            "channels": output.shape[0],
        }

    def save_chain(self, chain: VSTChain):
        """Save a VST chain."""
        self.chains[chain.name] = chain
        # Clear cache for this chain
        cache_keys = [k for k in self._pedalboard_cache if k.startswith(chain.name)]
        for k in cache_keys:
            del self._pedalboard_cache[k]

    def load_chain(self, chain_name: str) -> VSTChain | None:
        """Load a VST chain."""
        return self.chains.get(chain_name)

    def list_chains(self) -> list[str]:
        """List all saved chain names."""
        return list(self.chains.keys())

    def delete_chain(self, chain_name: str) -> bool:
        """Delete a VST chain."""
        if chain_name in self.chains:
            del self.chains[chain_name]
            return True
        return False

    def save_preset(self, preset: VSTPreset):
        """Save a preset for a plugin."""
        if preset.plugin_name not in self.presets:
            self.presets[preset.plugin_name] = []
        self.presets[preset.plugin_name].append(preset)

    def load_preset(self, plugin_name: str, preset_name: str) -> VSTPreset | None:
        """Load a preset for a plugin."""
        if plugin_name not in self.presets:
            return None
        for preset in self.presets[plugin_name]:
            if preset.name == preset_name:
                return preset
        return None

    def list_presets(self, plugin_name: str) -> list[str]:
        """List all presets for a plugin."""
        if plugin_name not in self.presets:
            return []
        return [p.name for p in self.presets[plugin_name]]

    def apply_preset(self, plugin_name: str, preset_name: str) -> dict[str, float]:
        """Apply a preset to a plugin and return parameter values."""
        preset = self.load_preset(plugin_name, preset_name)
        if not preset:
            raise ValueError(f"Preset not found: {preset_name}")
        return preset.parameters

    def export_chain(self, chain_name: str) -> dict:
        """Export a chain to a portable format."""
        chain = self.chains.get(chain_name)
        if not chain:
            raise ValueError(f"Chain not found: {chain_name}")

        return {
            "name": chain.name,
            "plugins": chain.plugins,
            "sample_rate": chain.sample_rate,
            "block_size": chain.block_size,
        }

    def import_chain(self, chain_data: dict) -> VSTChain:
        """Import a chain from exported format."""
        chain = VSTChain(
            name=chain_data["name"],
            plugins=chain_data["plugins"],
            sample_rate=chain_data.get("sample_rate", 44100),
            block_size=chain_data.get("block_size", 512),
        )
        self.save_chain(chain)
        return chain


# Global VST host instance
_vst_host: VSTHost | None = None


def get_vst_host() -> VSTHost:
    """Get or create the global VST host instance."""
    global _vst_host
    if _vst_host is None:
        _vst_host = VSTHost()
    return _vst_host


def reset_vst_host():
    """Reset the global VST host (for testing)."""
    global _vst_host
    _vst_host = None
