"""
NMA Remix Controller Node - Custom ComfyUI node for the Native Media AI Studio.

Controls remix mashup parameters in real-time, allowing dynamic adjustment
of layer gains, key shifts, and crossfades between different song sources.

Part of the ComfyUI bridge layer.
"""


class NMARemixControllerNode:
    """Controls remix mashup parameters.

    Selects a layer by index, applies gain_db and key_shift adjustments,
    and optionally crossfades toward the next layer using the ``crossfade``
    input (0.0 = current layer only, 1.0 = next layer only).
    """

    @classmethod
    def INPUT_TYPES(cls):  # noqa: N802
        return {
            "required": {
                "layers": ("REMIX_LAYERS",),
                "layer_index": ("INT", {"default": 0, "min": 0, "max": 1000}),
                "gain_db": ("FLOAT", {"default": 0.0, "min": -24.0, "max": 24.0, "step": 0.5}),
                "key_shift": ("FLOAT", {"default": 0.0, "min": -12.0, "max": 12.0, "step": 1.0}),
                "crossfade": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.1}),
            },
        }

    RETURN_TYPES = ("FLOAT", "FLOAT", "FLOAT", "STRING")
    RETURN_NAMES = ("effective_gain", "effective_key", "crossfade_amount", "active_layer")
    FUNCTION = "control"
    CATEGORY = "Native Media AI"
    OUTPUT_NODE = False

    def control(
        self,
        layers: list,
        layer_index: int,
        gain_db: float,
        key_shift: float,
        crossfade: float,
    ) -> tuple[float, float, float, str]:
        """Calculate effective parameters for the active layer with crossfade.

        Args:
            layers: List of layer dicts, each with keys like ``base_gain_db``,
                ``base_key``, ``name``.
            layer_index: Zero-based index into the layers list.
            gain_db: Gain adjustment in dB applied to the layer.
            key_shift: Key shift in semitones applied to the layer.
            crossfade: Crossfade amount from 0.0 (current layer) to 1.0
                (next layer).

        Returns:
            Tuple of (effective_gain_db, effective_key_semitones,
            crossfade_amount, active_layer_name).
        """
        # --- Input validation with safe fallbacks ---
        try:
            layers_list = list(layers) if layers else []
        except (TypeError, ValueError):
            layers_list = []

        gain_db = max(-24.0, min(24.0, float(gain_db)))
        key_shift = max(-12.0, min(12.0, float(key_shift)))
        crossfade = max(0.0, min(1.0, float(crossfade)))

        current_layer = None
        next_layer = None

        if 0 <= layer_index < len(layers_list):
            current = layers_list[layer_index]
            if isinstance(current, dict):
                current_layer = current
            # Look ahead for crossfade target
            if layer_index + 1 < len(layers_list):
                nxt = layers_list[layer_index + 1]
                if isinstance(nxt, dict):
                    next_layer = nxt

        if current_layer is None:
            # No valid layer found — return raw adjustments
            effective_gain = gain_db
            effective_key = key_shift
            active_layer = f"layer_{layer_index}"
        else:
            base_gain = float(current_layer.get("base_gain_db", 0.0))
            base_key = float(current_layer.get("base_key", 0.0))
            active_layer = str(current_layer.get("name", f"layer_{layer_index}"))

            effective_gain = base_gain + gain_db
            effective_key = base_key + key_shift

            # Apply crossfade toward next layer
            if next_layer is not None and crossfade > 0.0:
                next_gain = float(next_layer.get("base_gain_db", base_gain))
                next_key = float(next_layer.get("base_key", base_key))
                effective_gain = (1.0 - crossfade) * effective_gain + crossfade * next_gain
                effective_key = (1.0 - crossfade) * effective_key + crossfade * next_key

        return (effective_gain, effective_key, crossfade, active_layer)


NODE_CLASS_MAPPINGS = {
    "NMARemixControllerNode": NMARemixControllerNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NMARemixControllerNode": "NMA Remix Controller",
}