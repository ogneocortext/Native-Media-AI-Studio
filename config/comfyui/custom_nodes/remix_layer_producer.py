"""
NMA Remix Layer Producer - Custom ComfyUI node for the Native Media AI Studio.

Produces a REMIX_LAYERS bundle: a list of layer dicts, each with ``base_gain_db``,
``base_key`` (semitones), and ``name``. The bundle is consumed downstream by
NMARemixControllerNode to drive real-time mashup parameter control.

Part of the ComfyUI bridge layer - lives in config/comfyui/custom_nodes/
and is symlinked into ComfyUI's custom_nodes/ directory on startup.
"""


class NMARemixLayerProducer:
    """Produce a REMIX_LAYERS bundle for remix controller nodes.

    Accepts an optional JSON recipe string and returns a REMIX_LAYERS list of
    layer dicts, each with keys:

    - ``name``: str, human-readable layer name
    - ``base_gain_db``: float -24–24, base gain in dB
    - ``base_key``: float -12–12, base key shift in semitones

    When no recipe is provided, returns a single neutral layer so downstream
    nodes still execute.
    """

    @classmethod
    def INPUT_TYPES(cls):  # noqa: N802  # ComfyUI convention uses uppercase
        return {
            "required": {},
            "optional": {
                "recipe_json": (
                    "STRING",
                    {"default": "", "multiline": True, "placeholder": "{\"layers\": [...]}"},
                ),
            },
        }

    RETURN_TYPES = ("REMIX_LAYERS",)
    RETURN_NAMES = ("remix_layers",)
    FUNCTION = "produce"
    CATEGORY = "Native Media AI"
    OUTPUT_NODE = False

    def produce(
        self,
        recipe_json: str = "",
    ) -> tuple[list]:
        """Build the REMIX_LAYERS bundle.

        Args:
            recipe_json: Optional JSON string with a ``layers`` array. Each
                layer may have ``name``, ``base_gain_db``, ``base_key``.

        Returns:
            A one-tuple containing the REMIX_LAYERS list of layer dicts.
        """
        layers: list[dict] = []

        if recipe_json:
            try:
                import json

                recipe = json.loads(recipe_json)
                raw_layers = recipe.get("layers", []) if isinstance(recipe, dict) else []
            except (ValueError, TypeError):
                raw_layers = []
        else:
            raw_layers = []

        for layer in raw_layers:
            if not isinstance(layer, dict):
                continue
            name = str(layer.get("name", f"layer_{len(layers)}"))
            base_gain_db = float(layer.get("base_gain_db", 0.0))
            base_key = float(layer.get("base_key", 0.0))
            # Clamp to valid ranges
            base_gain_db = max(-24.0, min(24.0, base_gain_db))
            base_key = max(-12.0, min(12.0, base_key))
            layers.append(
                {
                    "name": name,
                    "base_gain_db": base_gain_db,
                    "base_key": base_key,
                }
            )

        if not layers:
            layers = [
                {
                    "name": "layer_0",
                    "base_gain_db": 0.0,
                    "base_key": 0.0,
                }
            ]

        return (layers,)


NODE_CLASS_MAPPINGS = {
    "NMARemixLayerProducer": NMARemixLayerProducer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NMARemixLayerProducer": "NMA Remix Layer Producer",
}
