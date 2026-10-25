"""
NMA Remix Controller Node - Custom ComfyUI node for the Native Media AI Studio.

Controls remix mashup parameters in real-time, allowing dynamic adjustment
of layer gains, key shifts, and crossfades between different song sources.

Part of the ComfyUI bridge layer.
"""



class NMARemixControllerNode:
    """Controls remix mashup parameters."""

    @classmethod
    def INPUT_TYPES(cls):  # noqa: N802
        return {
            "required": {
                "layers": ("REMIX_LAYERS",),
                "layer_index": ("INT", {"default": 0, "min": 0, "max": 15}),
                "gain_db": ("FLOAT", {"default": 0.0, "min": -24.0, "max": 24.0, "step": 0.5}),
                "key_shift": ("FLOAT", {"default": 0.0, "min": -12.0, "max": 12.0, "step": 1.0}),
                "crossfade": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.1}),
            },
        }

    RETURN_TYPES = ("FLOAT", "FLOAT", "FLOAT", "STRING")
    RETURN_NAMES = ("effective_gain", "effective_key", "crossfade_amount", "active_layer")
    FUNCTION = "control"
    CATEGORY = "Native Media AI"

    def control(self, layers, layer_index, gain_db, key_shift, crossfade):
        """Calculate effective parameters for the active layer."""
        if layer_index < len(layers):
            layer = layers[layer_index]
            effective_gain = layer.get("base_gain_db", 0.0) + gain_db
            effective_key = layer.get("base_key", 0.0) + key_shift
            active_layer = layer.get("name", f"layer_{layer_index}")
        else:
            effective_gain = gain_db
            effective_key = key_shift
            active_layer = f"layer_{layer_index}"

        return (effective_gain, effective_key, crossfade, active_layer)


NODE_CLASS_MAPPINGS = {
    "NMARemixControllerNode": NMARemixControllerNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NMARemixControllerNode": "NMA Remix Controller",
}
