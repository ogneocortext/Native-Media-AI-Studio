"""
AsciiArtService - ASCII Art Generation Service
Provides various ASCII art generation capabilities for the Native Media AI Studio.

Based on November 2026 best practices:
- chafa is the gold standard for terminal graphics
- Use 240-color mode for reliability (not 256)
- Symbol classes: block, half, quad, sextant, octant, braille
- Aspect ratio correction: terminal chars ~1:2 (h:w)
- Color space: din99d for perceptual accuracy
- Dithering: ordered (bayer) for clean output
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class AsciiOptions:
    """Options for ASCII art generation.

    Based on November 2026 best practices:
    - chafa is the gold standard for terminal graphics
    - Use 240-color mode for reliability (not 256)
    - Symbol classes: block, half, quad, sextant, octant, braille
    - Aspect ratio correction: terminal chars ~1:2 (h:w)
    - Color space: din99d for perceptual accuracy
    - Dithering: ordered (bayer) for clean output
    """
    width: int = 80
    height: int = 40
    colors: bool = True
    color_mode: str = "240"  # "none", "16", "240", "256", "full" (full only for sixel)
    color_space: str = "din99d"  # "rgb", "din99d"
    format: str = "symbols"  # "symbols", "braille", "blocks"
    symbol_classes: str = "block+border+stipple+braille"  # chafa symbol classes
    charset: str = "standard"  # "standard", "extended", "minimal", "braille"
    invert: bool = False
    dither: str = "ordered"  # "none", "ordered", "floyd-steinberg"
    dither_intensity: float = 1.0
    alpha: bool = True
    stretch: bool = True
    work_level: int = 5  # 1-9, CPU work level
    scale: str = "fit"  # "fit", "stretch", "zoom"


@dataclass
class AsciiResult:
    """Result of ASCII art generation."""
    ascii_art: str
    width: int
    height: int
    format: str
    source: str  # "image", "text", "video", "generated"
    metadata: dict = None


class AsciiArtService:
    """
    ASCII Art Generation Service.

    Provides multiple backends for ASCII art generation:
    - chafa: High-quality image/video to ASCII with color/Braille support
    - figlet/toilet: Text-to-banner generation
    - Python Rich/PyFiglet: Programmatic generation

    Automatically detects available tools and falls back gracefully.
    """

    def __init__(self):
        self._check_tools()

    def _check_tools(self) -> dict[str, bool]:
        """Check which ASCII tools are available."""
        self.tools_available = {
            "chafa": shutil.which("chafa") is not None,
            "figlet": shutil.which("figlet") is not None,
            "toilet": shutil.which("toilet") is not None,
            "lolcat": shutil.which("lolcat") is not None,
            "boxes": shutil.which("boxes") is not None,
        }
        logger.info(f"ASCII tools available: {self.tools_available}")
        return self.tools_available

    # ------------------------------------------------------------------
    # Image → ASCII Conversion
    # ------------------------------------------------------------------

    async def image_to_ascii(
        self,
        image_path: str | Path,
        options: AsciiOptions | None = None
    ) -> AsciiResult:
        """
        Convert an image file to ASCII art.

        Uses chafa as primary backend with fallbacks.
        """
        options = options or AsciiOptions()
        image_path = Path(image_path)

        if not image_path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")

        # Try chafa first (best quality)
        if self.tools_available.get("chafa"):
            return await self._chafa_image(image_path, options)

        # Fallback: try Python libraries
        return await self._python_fallback(image_path, options)

    async def _chafa_image(self, image_path: Path, options: AsciiOptions) -> AsciiResult:
        """Convert image using chafa (best quality).

        Based on November 2026 best practices:
        - Use 240-color mode for reliability (not 256)
        - Symbol classes: block+border+stipple+braille for best quality
        - Color space: din99d for perceptual accuracy
        - Dithering: ordered (bayer) for clean output
        - Aspect ratio correction: terminal chars ~1:2 (h:w)
        """
        cmd = ["chafa"]

        # Size with aspect ratio correction
        # Terminal chars are ~1:2 (height:width), so we adjust
        if options.height and options.width:
            # chafa handles aspect correction with --stretch
            cmd.extend(["-s", f"{options.width}x{options.height}"])

        # Format
        cmd.extend(["-f", "symbols"])  # Unicode symbols by default

        # Colors - Use 240 for reliability (not 256)
        if options.colors:
            if options.color_mode == "full":
                cmd.extend(["--colors", "full"])  # Only works with sixel
            elif options.color_mode == "240":
                cmd.extend(["--colors", "240"])  # Recommended for reliability
            elif options.color_mode == "256":
                cmd.extend(["--colors", "256"])
            elif options.color_mode == "16":
                cmd.extend(["--colors", "16"])
        else:
            cmd.extend(["--colors", "none"])

        # Color space - din99d for perceptual accuracy
        cmd.extend(["--color-space", options.color_space])

        # Symbol classes - combine for best quality
        # block+border+stipple+braille gives best quality
        cmd.extend(["--symbols", options.symbol_classes])

        # Dithering
        if options.dither != "none":
            cmd.extend(["--dither", options.dither])
            if options.dither_intensity != 1.0:
                cmd.extend(["--dither-intensity", str(options.dither_intensity)])

        # Alpha transparency
        if options.alpha:
            cmd.append("--alpha")

        # Stretch to fit
        if options.stretch:
            cmd.append("--stretch")

        # Work level (CPU effort)
        cmd.extend(["--work", str(options.work_level)])

        # Scale mode
        if options.scale != "fit":
            cmd.extend(["--scale", options.scale])

        # Invert
        if options.invert:
            cmd.append("-i")

        cmd.append(str(image_path))

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                raise RuntimeError(f"chafa failed: {stderr.decode()}")

            ascii_art = stdout.decode("utf-8")
            return AsciiResult(
                ascii_art=ascii_art,
                width=options.width,
                height=options.height,
                format="chafa",
                source="image",
                metadata={"tool": "chafa", "options": vars(options)}
            )
        except Exception as e:
            logger.warning(f"chafa failed: {e}")
            raise

    async def _python_fallback(self, image_path: Path, options: AsciiOptions) -> AsciiResult:
        """Fallback using Python PIL + manual conversion."""
        try:
            from PIL import Image
        except ImportError:
            raise RuntimeError("PIL not available for fallback") from None

        # Simple brightness mapping
        ramp = " @%#*+=-:. "

        with Image.open(image_path) as img:
            # Resize preserving aspect
            img = img.convert("L")  # Grayscale
            aspect = img.height / img.width
            int(options.width * aspect * 0.5)
            img = img.resize((options.width, options.height))

            pixels = img.load()
            lines = []
            for y in range(img.height):
                line = ""
                for x in range(img.width):
                    brightness = pixels[x, y] / 255.0
                    idx = int(brightness * (len(ramp) - 1))
                    line += ramp[idx]
                lines.append(line)

            ascii_art = "\n".join(lines)

            return AsciiResult(
                ascii_art=ascii_art,
                width=options.width,
                height=options.height,
                format="pil-fallback",
                source="image",
                metadata={"tool": "PIL-fallback"}
            )

    # ------------------------------------------------------------------
    # Text → Banner (figlet/toilet)
    # ------------------------------------------------------------------

    async def text_to_banner(
        self,
        text: str,
        font: str = "slant",
        width: int = 80,
        *,
        color: bool = True,
        font_list: bool = False
    ) -> AsciiResult:
        """Generate ASCII banner from text using figlet/toilet."""

        if font_list:
            return await self._list_fonts()

        # Try toilet first (supports color)
        if self.tools_available.get("toilet") and color:
            return await self._toilet_banner(text, font, color=color)

        # Fallback to figlet
        if self.tools_available.get("figlet"):
            return await self._figlet_banner(text, font, color=color)

        # Fallback: Python PyFiglet
        return await self._pyfiglet_banner(text, font)

    async def _toilet_banner(self, text: str, font: str, *, color: bool) -> AsciiResult:
        """Generate banner using toilet (supports color)."""
        cmd = ["toilet"]

        if font:
            cmd.extend(["-f", font])
        cmd.extend(["-w", "80"])  # Width

        if color:
            cmd.extend(["-F", "metal"])  # Metal color filter

        cmd.append(text)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                raise RuntimeError(f"toilet failed: {stderr.decode()}")

            return AsciiResult(
                ascii_art=stdout.decode("utf-8"),
                width=80,
                height=0,
                format="toilet",
                source="text",
                metadata={"tool": "toilet", "font": font}
            )
        except Exception as e:
            logger.warning(f"toilet failed: {e}")
            raise

    async def _figlet_banner(self, text: str, font: str, *, color: bool) -> AsciiResult:
        """Generate banner using figlet."""
        cmd = ["figlet"]

        if font:
            cmd.extend(["-f", font])
        cmd.extend(["-w", "80"])

        if not color:
            cmd.append("-k")  # No smushing

        cmd.append(text)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                raise RuntimeError(f"figlet failed: {stderr.decode()}")

            ascii_art = stdout.decode("utf-8")

            # Add color with lolcat if available
            if self.tools_available.get("lolcat"):
                ascii_art = await self._lolcat(ascii_art)

            return AsciiResult(
                ascii_art=ascii_art,
                width=80,
                height=0,
                format="figlet",
                source="text",
                metadata={"tool": "figlet", "font": font}
            )
        except Exception as e:
            logger.warning(f"figlet failed: {e}")
            raise

    async def _pyfiglet_banner(self, text: str, font: str) -> AsciiResult:
        """Generate banner using Python PyFiglet."""
        try:
            from pyfiglet import figlet_format
        except ImportError:
            raise RuntimeError("PyFiglet not available") from None

        ascii_art = figlet_format(text, font=font, width=80)

        return AsciiResult(
            ascii_art=ascii_art,
            width=80,
            height=0,
            format="pyfiglet",
            source="text",
            metadata={"tool": "pyfiglet", "font": font}
        )

    async def _lolcat(self, text: str) -> str:
        """Add rainbow colors using lolcat."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "lolcat",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate(input=text.encode())

            if proc.returncode != 0:
                return text

            return stdout.decode("utf-8")
        except Exception:
            return text

    async def _list_fonts(self) -> AsciiResult:
        """List available figlet/toilet fonts."""
        fonts = []

        if self.tools_available.get("figlet"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "showfigfonts",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, _ = await proc.communicate()
                fonts.extend(stdout.decode().strip().split("\n"))
            except Exception:
                pass

        return AsciiResult(
            ascii_art="\n".join(fonts) if fonts else "No fonts found",
            width=0,
            height=0,
            format="font-list",
            source="generated",
            metadata={"fonts": fonts}
        )

    # ------------------------------------------------------------------
    # Utility Methods
    # ------------------------------------------------------------------

    def get_available_tools(self) -> dict[str, bool]:
        """Return dict of available tools."""
        return self._check_tools()

    def get_available_fonts(self) -> list[str]:
        """Get list of available figlet/toilet fonts (sync version)."""
        fonts = []
        if self.tools_available.get("figlet"):
            try:
                result = subprocess.run(["showfigfonts"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10)
                if result.returncode == 0:
                    fonts = result.stdout.strip().split("\n")
            except Exception:
                pass
        return fonts

    # ------------------------------------------------------------------
    # Rich + PyFiglet Integration (for Python code)
    # ------------------------------------------------------------------

    @staticmethod
    def rich_banner(text: str, font: str = "slant", style: str = "bold cyan") -> str:
        """Generate banner using Rich + PyFiglet."""
        try:
            from pyfiglet import figlet_format
            from rich.console import Console

            Console()
            ascii_art = figlet_format(text, font=font, width=80)
            return ascii_art
        except ImportError:
            raise RuntimeError("Rich or PyFiglet not available") from None

    @staticmethod
    def rich_panel(content: str, title: str = "", style: str = "cyan") -> str:
        """Create a Rich panel with ASCII content."""
        try:
            from rich.console import Console
            from rich.panel import Panel

            console = Console()
            panel = Panel(content, title=title, border_style=style, expand=False)
            with console.capture() as capture:
                console.print(panel)
            return capture.get()
        except ImportError:
            return content


# ------------------------------------------------------------------
# Convenience Functions
# ------------------------------------------------------------------

# Global service instance
_ascii_service: AsciiArtService | None = None


def get_ascii_service() -> AsciiArtService:
    """Get global ASCII art service instance."""
    global _ascii_service
    if _ascii_service is None:
        _ascii_service = AsciiArtService()
    return _ascii_service


async def image_to_ascii(
    image_path: str | Path,
    width: int = 80,
    height: int = 40,
    *,
    colors: bool = True,
    format: str = "symbols"
) -> AsciiResult:
    """Quick image to ASCII conversion."""
    service = get_ascii_service()
    options = AsciiOptions(
        width=width,
        height=height,
        colors=colors,
        format=format
    )
    return await service.image_to_ascii(Path(image_path), options)


async def text_to_banner(
    text: str,
    font: str = "slant",
    width: int = 80,
    *,
    color: bool = True
) -> AsciiResult:
    """Quick text to banner."""
    service = get_ascii_service()
    return await service.text_to_banner(text, font=font, width=80, color=color)
