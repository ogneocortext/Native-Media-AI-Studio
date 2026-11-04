/**
 * RemixPanel — build and hear a mashup from stems of different songs.
 *
 * Single source of truth lives in `features/remix/RemixPanel.tsx`. This file
 * re-exports it so the Visualizer's "Stem Mixer" entry point keeps working
 * without duplicating 1.5 k lines of logic.
 */
export { RemixPanel, type RemixPanelProps } from "../../remix/RemixPanel";
