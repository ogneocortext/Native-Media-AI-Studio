/**
 * A/B comparison for the remix panel: pin two arrangements, flip between them.
 *
 * Single source of truth lives in `features/remix/abCompare.ts`. This file
 * re-exports it so the Visualizer copy and its tests keep working without
 * duplicating the logic.
 */
export * from "../../remix/abCompare";
