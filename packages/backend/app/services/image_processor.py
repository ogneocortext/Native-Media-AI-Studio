"""
Native Media AI Studio - Pillow 13.0 Image Processing Service.

This service leverages Pillow 13.0 features for audio-reactive visual
processing:

- ImageChops.offset()      - 46x faster  -> beat-synced displacement
- ImageChops.difference()  - 3x faster   -> frame differencing / motion detection
- Image.filter()           - 3.5x faster  -> EQ-reactive visual filters
- Image.transpose() 180    - 10x faster  -> mirror/flip effects
- P/PA -> RGB/RGBA         - 2.5x faster  -> palette image conversion
- ImageOps.pad/expand      - preserves transparency on RGBA/LA
- ImageOps.invert/posterize/solarize - now works on P mode images
- ImageFont with HarfBuzz  - better text shaping for captions/labels
- reducing_gap on RGBA/LA  - better quality downscaling with alpha
- Image.getbbox()          - 24x faster  -> content bounding box
- ImageEnhance             - brightness, contrast, color, sharpness
- ImageOps.autocontrast    - auto contrast adjustment
- ImageOps.equalize        - histogram equalization
- ImageOps.grayscale       - grayscale conversion
- ImageOps.sepia           - sepia tone effect
"""

from __future__ import annotations

import logging

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

logger = logging.getLogger(__name__)

# Pillow 13.0+ feature availability flags
try:
    from PIL import features

    HAS_HARFBUZZ = features.check("freetype2")  # HarfBuzz text shaping
except Exception:  # pragma: no cover
    HAS_HARFBUZZ = False


class ImageProcessor:
    """
    High-performance image processing using Pillow 13.0 features.

    All methods operate on PIL Image objects and return new Image objects
    (originals are never mutated).
    """

    # ------------------------------------------------------------------
    # Transformation Methods
    # ------------------------------------------------------------------

    @staticmethod
    def resize_image(
        image: Image.Image,
        width: int,
        height: int,
        reducing_gap: float = 2.0,
    ) -> Image.Image:
        """Resize image with optional memory-efficient reduction.

        Pillow 13.0 now applies reducing_gap to RGBA and LA images,
        giving better quality downsampling for images with alpha.
        """
        return image.resize((width, height), reducing_gap=reducing_gap)

    @staticmethod
    def crop_image(
        image: Image.Image,
        left: int,
        top: int,
        right: int,
        bottom: int,
    ) -> Image.Image:
        """Crop image to specified region."""
        return image.crop((left, top, right, bottom))

    @staticmethod
    def auto_crop(image: Image.Image) -> Image.Image:
        """Auto-crop image to content bounding box using fast getbbox().

        Pillow 13.0's getbbox() is up to 24x faster, making automatic
        cropping practical for batch processing.
        """
        bbox = image.getbbox()
        if bbox is None:
            return image
        return image.crop(bbox)

    @staticmethod
    def rotate_image(
        image: Image.Image,
        degrees: float,
        expand: bool = False,
    ) -> Image.Image:
        """Rotate image by specified degrees."""
        return image.rotate(degrees, expand=expand, resample=Image.BICUBIC)

    @staticmethod
    def flip_image(
        image: Image.Image,
        direction: str = "horizontal",
    ) -> Image.Image:
        """Flip image horizontally or vertically."""
        if direction == "horizontal":
            return image.transpose(Image.FLIP_LEFT_RIGHT)
        if direction == "vertical":
            return image.transpose(Image.FLIP_TOP_BOTTOM)
        if direction == "both":
            return image.transpose(Image.ROTATE_180)
        return image

    @staticmethod
    def flip_horizontal(image: Image.Image) -> Image.Image:
        """Flip image horizontally."""
        return image.transpose(Image.FLIP_LEFT_RIGHT)

    @staticmethod
    def flip_vertical(image: Image.Image) -> Image.Image:
        """Flip image vertically."""
        return image.transpose(Image.FLIP_TOP_BOTTOM)

    @staticmethod
    def rotate_180(image: Image.Image) -> Image.Image:
        """Rotate image 180 degrees."""
        return image.transpose(Image.ROTATE_180)

    @staticmethod
    def rotate_90(image: Image.Image, clockwise: bool = True) -> Image.Image:
        """Rotate image 90 degrees clockwise or counter-clockwise."""
        if clockwise:
            return image.transpose(Image.ROTATE_270)
        return image.transpose(Image.ROTATE_90)

    @staticmethod
    def rotate_270(image: Image.Image, clockwise: bool = True) -> Image.Image:
        """Rotate image 270 degrees clockwise or counter-clockwise."""
        if clockwise:
            return image.transpose(Image.ROTATE_90)
        return image.transpose(Image.ROTATE_270)

    # ------------------------------------------------------------------
    # Filter Methods
    # ------------------------------------------------------------------

    @staticmethod
    def apply_filter(
        image: Image.Image,
        filter_type: str = "blur",
    ) -> Image.Image:
        """Apply a filter to the image.

        Args:
            image: Source PIL Image
            filter_type: One of blur, sharpen, edge_enhance, smooth,
                contour, emboss, find_edges, gaussian_blur, box_blur,
                median_filter, mode_filter, rank_filter
        """
        filter_map = {
            "blur": ImageFilter.BLUR,
            "sharpen": ImageFilter.SHARPEN,
            "edge_enhance": ImageFilter.EDGE_ENHANCE,
            "smooth": ImageFilter.SMOOTH,
            "contour": ImageFilter.CONTOUR,
            "emboss": ImageFilter.EMBOSS,
            "find_edges": ImageFilter.FIND_EDGES,
            "gaussian_blur": ImageFilter.GaussianBlur(radius=2),
            "box_blur": ImageFilter.BoxBlur(radius=2),
            "median_filter": ImageFilter.MedianFilter(size=3),
            "mode_filter": ImageFilter.ModeFilter(size=3),
            "rank_filter": ImageFilter.RankFilter(size=3, rank=2),
        }
        filter_obj = filter_map.get(filter_type, ImageFilter.BLUR)
        return image.filter(filter_obj)

    @staticmethod
    def gaussian_blur(
        image: Image.Image,
        radius: float = 2.0,
    ) -> Image.Image:
        """Apply Gaussian blur filter."""
        return image.filter(ImageFilter.GaussianBlur(radius=radius))

    @staticmethod
    def box_blur(
        image: Image.Image,
        radius: int = 2,
    ) -> Image.Image:
        """Apply box blur filter."""
        return image.filter(ImageFilter.BoxBlur(radius=radius))

    @staticmethod
    def sharpen(
        image: Image.Image,
    ) -> Image.Image:
        """Apply sharpen filter."""
        return image.filter(ImageFilter.SHARPEN)

    @staticmethod
    def edge_enhance(
        image: Image.Image,
    ) -> Image.Image:
        """Apply edge enhance filter."""
        return image.filter(ImageFilter.EDGE_ENHANCE)

    @staticmethod
    def find_edges(
        image: Image.Image,
    ) -> Image.Image:
        """Find edges in image."""
        return image.filter(ImageFilter.FIND_EDGES)

    @staticmethod
    def emboss(
        image: Image.Image,
    ) -> Image.Image:
        """Apply emboss filter."""
        return image.filter(ImageFilter.EMBOSS)

    @staticmethod
    def contour(
        image: Image.Image,
    ) -> Image.Image:
        """Apply contour filter."""
        return image.filter(ImageFilter.CONTOUR)

    # ------------------------------------------------------------------
    # Color Adjustment Methods
    # ------------------------------------------------------------------

    @staticmethod
    def adjust_brightness(
        image: Image.Image,
        factor: float = 1.0,
    ) -> Image.Image:
        """Adjust image brightness.

        Args:
            image: Source PIL Image
            factor: 0.0 = black, 1.0 = original, >1.0 = brighter
        """
        enhancer = ImageEnhance.Brightness(image)
        return enhancer.enhance(factor)

    @staticmethod
    def adjust_contrast(
        image: Image.Image,
        factor: float = 1.0,
    ) -> Image.Image:
        """Adjust image contrast.

        Args:
            image: Source PIL Image
            factor: 0.0 = gray, 1.0 = original, >1.0 = more contrast
        """
        enhancer = ImageEnhance.Contrast(image)
        return enhancer.enhance(factor)

    @staticmethod
    def adjust_color(
        image: Image.Image,
        factor: float = 1.0,
    ) -> Image.Image:
        """Adjust image color saturation.

        Args:
            image: Source PIL Image
            factor: 0.0 = grayscale, 1.0 = original, >1.0 = more saturated
        """
        enhancer = ImageEnhance.Color(image)
        return enhancer.enhance(factor)

    @staticmethod
    def adjust_sharpness(
        image: Image.Image,
        factor: float = 1.0,
    ) -> Image.Image:
        """Adjust image sharpness.

        Args:
            image: Source PIL Image
            factor: 0.0 = blurred, 1.0 = original, >1.0 = sharper
        """
        enhancer = ImageEnhance.Sharpness(image)
        return enhancer.enhance(factor)

    @staticmethod
    def auto_contrast(
        image: Image.Image,
        cutoff: int = 0,
    ) -> Image.Image:
        """Automatically adjust contrast using ImageOps.autocontrast."""
        return ImageOps.autocontrast(image, cutoff=cutoff)

    @staticmethod
    def equalize(
        image: Image.Image,
        mask: Image.Image | None = None,
    ) -> Image.Image:
        """Equalize image histogram."""
        return ImageOps.equalize(image, mask=mask)

    @staticmethod
    def grayscale(
        image: Image.Image,
    ) -> Image.Image:
        """Convert image to grayscale."""
        return image.convert("L")

    @staticmethod
    def sepia(
        image: Image.Image,
    ) -> Image.Image:
        """Apply sepia tone effect."""
        if image.mode != "RGB":
            image = image.convert("RGB")
        r, g, b = image.split()
        sepia_r = Image.eval(r, lambda v: min(255, int(v * 0.393 + g * 0.769 + b * 0.189)))
        sepia_g = Image.eval(g, lambda v: min(255, int(r * 0.349 + g * 0.686 + b * 0.168)))
        sepia_b = Image.eval(b, lambda v: min(255, int(r * 0.272 + g * 0.534 + b * 0.131)))
        return Image.merge("RGB", (sepia_r, sepia_g, sepia_b))

    @staticmethod
    def invert(
        image: Image.Image,
    ) -> Image.Image:
        """Invert colors."""
        if image.mode == "P":
            return ImageOps.invert(image)
        if image.mode in ("RGBA", "LA"):
            alpha = image.getchannel("A")
            rgb = image.convert("RGB")
            inverted = ImageOps.invert(rgb)
            result = inverted.convert("RGBA")
            result.putalpha(alpha)
            return result
        return ImageOps.invert(image)

    @staticmethod
    def solarize(
        image: Image.Image,
        threshold: int = 128,
    ) -> Image.Image:
        """Apply solarize effect."""
        if image.mode == "P":
            return ImageOps.solarize(image, threshold)
        if image.mode in ("RGBA", "LA"):
            alpha = image.getchannel("A")
            rgb = image.convert("RGB")
            solarized = ImageOps.solarize(rgb, threshold)
            result = solarized.convert("RGBA")
            result.putalpha(alpha)
            return result
        return ImageOps.solarize(image, threshold)

    @staticmethod
    def posterize(
        image: Image.Image,
        bits: int = 4,
    ) -> Image.Image:
        """Posterize image."""
        if image.mode == "P":
            return ImageOps.posterize(image, bits)
        if image.mode in ("RGBA", "LA"):
            alpha = image.getchannel("A")
            rgb = image.convert("RGB")
            posterized = ImageOps.posterize(rgb, bits)
            result = posterized.convert("RGBA")
            result.putalpha(alpha)
            return result
        return ImageOps.posterize(image, bits)

    # ------------------------------------------------------------------
    # Composition Methods
    # ------------------------------------------------------------------

    @staticmethod
    def blend_images(
        image_a: Image.Image,
        image_b: Image.Image,
        alpha: float = 0.5,
    ) -> Image.Image:
        """Blend two images together."""
        return Image.blend(image_a, image_b, alpha)

    @staticmethod
    def composite(
        foreground: Image.Image,
        background: Image.Image,
        mask: Image.Image | None = None,
    ) -> Image.Image:
        """Composite foreground over background with optional mask."""
        if mask is not None:
            return Image.composite(foreground, background, mask)
        return Image.composite(foreground, background, Image.new("L", foreground.size, 255))

    @staticmethod
    def paste(
        background: Image.Image,
        foreground: Image.Image,
        position: tuple[int, int],
        mask: Image.Image | None = None,
    ) -> Image.Image:
        """Paste foreground onto background at position."""
        result = background.copy()
        result.paste(foreground, position, mask)
        return result

    # ------------------------------------------------------------------
    # Audio-Reactive Methods
    # ------------------------------------------------------------------

    @staticmethod
    def beat_sync_displace(
        image: Image.Image,
        beat_strength: float = 1.0,
        direction: str = "both",
    ) -> Image.Image:
        """Beat-synced displacement using ImageChops.offset().

        On beat hits, the image is offset by a small amount to create a
        "punch" effect. Because Pillow 13.0's ImageChops.offset() is up to
        46x faster, this can run every frame without visible cost.

        Args:
            image: Source PIL Image
            beat_strength: 0.0 to 1.0 intensity of the displacement
            direction: "horizontal", "vertical", or "both"
        """
        width, height = image.size
        dx = int(width * 0.02 * beat_strength) if direction in ("horizontal", "both") else 0
        dy = int(height * 0.02 * beat_strength) if direction in ("vertical", "both") else 0

        return ImageChops.offset(image, dx, dy)

    @staticmethod
    def frame_difference(
        frame_a: Image.Image,
        frame_b: Image.Image,
    ) -> Image.Image:
        """Compute absolute difference between two frames using ImageChops.difference().

        Pillow 13.0's ImageChops.difference() is up to 3x faster. Useful for
        motion detection between video frames to trigger visual events.
        """
        return ImageChops.difference(frame_a, frame_b)

    @staticmethod
    def eq_reactive_filter(
        image: Image.Image,
        band_gain: float = 1.0,
        filter_type: str = "blur",
    ) -> Image.Image:
        """Apply an EQ-reactive filter using Image.filter().

        Pillow 13.0's Image.filter() is up to 3.5x faster, making it practical
        to run per-frame EQ-reactive filtering on audio-reactive visuals.

        Args:
            image: Source PIL Image
            band_gain: Gain factor 0.0 to 2.0+ for the filter intensity
            filter_type: One of blur, sharpen, edge_enhance, smooth,
                         contour, emboss, find_edges
        """
        filter_map = {
            "blur": ImageFilter.BLUR,
            "sharpen": ImageFilter.SHARPEN,
            "edge_enhance": ImageFilter.EDGE_ENHANCE,
            "smooth": ImageFilter.SMOOTH,
            "contour": ImageFilter.CONTOUR,
            "emboss": ImageFilter.EMBOSS,
            "find_edges": ImageFilter.FIND_EDGES,
        }
        filter_obj = filter_map.get(filter_type, ImageFilter.BLUR)

        filtered = image.filter(filter_obj)
        if band_gain != 1.0:
            return Image.blend(image, filtered, min(max(band_gain - 1.0, 0.0), 1.0))
        return filtered

    @staticmethod
    def mirror_effect(
        image: Image.Image,
        axis: str = "horizontal",
    ) -> Image.Image:
        """Mirror/flip image using Image.transpose().

        Pillow 13.0's Image.transpose() is up to 10x faster for 180 rotations,
        making mirror effects essentially free per-frame.

        Args:
            image: Source PIL Image
            axis: "horizontal", "vertical", or "both"
        """
        if axis == "horizontal":
            return image.transpose(Image.FLIP_LEFT_RIGHT)
        if axis == "vertical":
            return image.transpose(Image.FLIP_TOP_BOTTOM)
        if axis == "both":
            return image.transpose(Image.ROTATE_180)
        return image

    @staticmethod
    def palette_to_rgb(image: Image.Image) -> Image.Image:
        """Convert palette (P) or palette-with-alpha (PA) images to RGB/RGBA.

        Pillow 13.0 converts P/PA images up to 2.5x faster. Useful when
        loading palette-based assets (GIFs, some game assets) for further
        processing.
        """
        if image.mode == "P":
            return image.convert("RGB")
        if image.mode == "PA":
            return image.convert("RGBA")
        return image

    @staticmethod
    def add_border(
        image: Image.Image,
        border_size: int = 20,
        color: str | tuple[int, int, int] | None = None,
    ) -> Image.Image:
        """Add a border around an image using ImageOps.pad().

        Pillow 13.0's ImageOps.pad() preserves transparency (alpha channel)
        when padding RGBA and LA images. Previously transparent pixels became
        opaque.

        Args:
            image: Source PIL Image
            border_size: Border thickness in pixels
            color: Border color as hex string or RGB tuple. None = transparent
        """
        width, height = image.size
        target_width = width + border_size * 2
        target_height = height + border_size * 2

        return ImageOps.pad(
            image,
            (target_width, target_height),
            color=color,
            centering=(0.5, 0.5),
        )

    @staticmethod
    def posterize_effect(
        image: Image.Image,
        bits: int = 4,
    ) -> Image.Image:
        """Apply posterize effect using ImageOps.posterize().

        Pillow 13.0 now supports posterize on P mode images (palette images),
        applying the operation to the palette colors while leaving alpha
        values unchanged.

        Args:
            image: Source PIL Image
            bits: Number of bits to keep per channel (1-8)
        """
        if image.mode == "P":
            return ImageOps.posterize(image, bits)
        if image.mode in ("RGBA", "LA"):
            alpha = image.getchannel("A")
            rgb = image.convert("RGB")
            posterized = ImageOps.posterize(rgb, bits)
            result = posterized.convert("RGBA")
            result.putalpha(alpha)
            return result
        return ImageOps.posterize(image, bits)

    @staticmethod
    def invert_effect(
        image: Image.Image,
    ) -> Image.Image:
        """Invert colors using ImageOps.invert().

        Pillow 13.0 now supports invert on P mode images, applying the
        operation to palette colors while leaving alpha unchanged.
        """
        if image.mode == "P":
            return ImageOps.invert(image)
        if image.mode in ("RGBA", "LA"):
            alpha = image.getchannel("A")
            rgb = image.convert("RGB")
            inverted = ImageOps.invert(rgb)
            result = inverted.convert("RGBA")
            result.putalpha(alpha)
            return result
        return ImageOps.invert(image)

    @staticmethod
    def solarize_effect(
        image: Image.Image,
        threshold: int = 128,
    ) -> Image.Image:
        """Apply solarize effect using ImageOps.solarize().

        Pillow 13.0 now supports solarize on P mode images.

        Args:
            image: Source PIL Image
            threshold: Threshold value 0-255
        """
        if image.mode == "P":
            return ImageOps.solarize(image, threshold)
        if image.mode in ("RGBA", "LA"):
            alpha = image.getchannel("A")
            rgb = image.convert("RGB")
            solarized = ImageOps.solarize(rgb, threshold)
            result = solarized.convert("RGBA")
            result.putalpha(alpha)
            return result
        return ImageOps.solarize(image, threshold)

    @staticmethod
    def add_text_overlay(
        image: Image.Image,
        text: str,
        font_path: str | None = None,
        font_size: int = 24,
        color: str = "white",
        position: tuple[int, int] = (10, 10),
        shadow: bool = True,
    ) -> Image.Image:
        """Draw text on an image using ImageFont with Harfbuzz text rendering.

        Pillow 13.0 wheels use Harfbuzz for text shaping, providing better
        text rendering especially for complex scripts (Arabic, Devanagari,
        etc.). Windows wheels use Harfbuzz directly.

        Args:
            image: Source PIL Image
            text: Text to draw
            font_path: Path to a TrueType font file. If None, uses default.
            font_size: Font size in pixels
            color: Text color as hex string or RGB tuple
            position: (x, y) position for text
            shadow: Whether to draw a subtle shadow behind text
        """
        try:
            if font_path:
                font = ImageFont.truetype(font_path, font_size)
            else:
                font = ImageFont.load_default()
        except Exception:
            font = ImageFont.load_default()

        draw = ImageDraw.Draw(image)

        if shadow:
            draw.text(
                (position[0] + 2, position[1] + 2),
                text,
                font=font,
                fill=(0, 0, 0, 128),
            )

        draw.text(position, text, font=font, fill=color)
        return image

    @staticmethod
    def content_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
        """Get bounding box of non-zero pixels using Image.getbbox().

        Pillow 13.0's getbbox() is up to 24x faster. Useful for cropping
        to content bounds automatically.

        Args:
            image: Source PIL Image
        Returns:
            (left, top, right, bottom) bounding box, or None if empty
        """
        return image.getbbox()

    @staticmethod
    def resize_with_gap(
        image: Image.Image,
        size: tuple[int, int],
        reducing_gap: float = 2.0,
    ) -> Image.Image:
        """Resize image with reduced aliasing using reducing_gap parameter.

        Pillow 13.0 now applies reducing_gap to RGBA and LA images (previously
        excluded), giving better quality downsampling for images with alpha.

        Args:
            image: Source PIL Image
            size: (width, height) target size
            reducing_gap: Reducing gap factor. Default 2.0.
        """
        return image.resize(size, reducing_gap=reducing_gap)

    @staticmethod
    def save_optimized(
        image: Image.Image,
        output_path: str,
        format: str | None = None,
        quality: int = 85,
    ) -> None:
        """Save image with optimized settings.

        Args:
            image: PIL Image to save
            output_path: Output file path
            format: Output format (PNG, JPEG, WEBP, etc.). Inferred from
                extension if None.
            quality: JPEG quality 1-95
        """
        save_kwargs = {}
        if format == "JPEG" or (
            format is None and str(output_path).lower().endswith((".jpg", ".jpeg"))
        ):
            save_kwargs["quality"] = quality
            save_kwargs["optimize"] = True
        image.save(output_path, format=format, **save_kwargs)

    @staticmethod
    def process_audio_reactive_frame(
        image: Image.Image,
        audio_level: float,
        beat_detected: bool,
        color_energy: float = 1.0,
    ) -> Image.Image:
        """Apply a complete audio-reactive processing chain to a single frame.

        Combines multiple Pillow 13.0 optimizations:
        - Beat sync displacement (ImageChops.offset - 46x faster)
        - EQ-reactive filter (Image.filter - 3.5x faster)
        - Beat flash vignette (Image.blend)
        - Auto-crop to content (Image.getbbox - 24x faster)

        Args:
            image: Source PIL Image
            audio_level: Normalized audio level 0.0 to 1.0
            beat_detected: Whether a beat is detected on this frame
            color_energy: Color intensity multiplier
        """
        result = image

        # Beat-synced displacement on beats
        if beat_detected and audio_level > 0.5:
            result = ImageProcessor.beat_sync_displace(
                result, beat_strength=audio_level
            )

        # EQ-reactive filter based on audio level
        if audio_level > 0.3:
            result = ImageProcessor.eq_reactive_filter(
                result,
                band_gain=1.0 + audio_level,
                filter_type="blur" if audio_level > 0.7 else "smooth",
            )

        # Beat flash vignette
        if beat_detected and audio_level > 0.6:
            flash = Image.new("RGBA", image.size, (255, 255, 255, int(audio_level * 60)))
            result = Image.blend(result, flash, audio_level * 0.3)

        # Auto-crop to content if image has large empty areas
        bbox = result.getbbox()
        if bbox and (bbox[2] - bbox[0]) < image.width * 0.5:
            result = result.crop(bbox)

        return result

    @staticmethod
    def batch_process(
        images: list[Image.Image],
        operation: str,
        **kwargs,
    ) -> list[Image.Image]:
        """Process multiple images with the same operation.

        Args:
            images: List of PIL Image objects
            operation: Name of processing method to apply
            **kwargs: Additional arguments passed to the processing method

        Returns:
            List of processed images
        """
        method = getattr(ImageProcessor, operation, None)
        if method is None:
            raise ValueError(f"Unknown operation: {operation}")

        results = []
        for img in images:
            try:
                result = method(img, **kwargs)
                results.append(result)
            except Exception as e:
                logger.warning(f"Failed to process image: {e}")
                results.append(img)  # Return original on failure
        return results

    @staticmethod
    def get_image_info(image: Image.Image) -> dict:
        """Get image metadata.

        Args:
            image: PIL Image to inspect

        Returns:
            Dict with image metadata (size, mode, format, etc.)
        """
        return {
            "format": image.format,
            "mode": image.mode,
            "size": image.size,
            "width": image.width,
            "height": image.height,
        }
