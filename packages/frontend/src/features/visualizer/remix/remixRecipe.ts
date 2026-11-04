/**
 * Conversions between a wire-format remix recipe and the panel's editable state.
 *
 * Single source of truth lives in `features/remix/remixRecipe.ts`. This file
 * re-exports it so the Visualizer copy and its tests keep working without
 * duplicating the logic.
 */
export * from "../../remix/remixRecipe";
