/**
 * BrandMark — animated sidebar logo.
 *
 * A 4-bar equalizer mark on the brand gradient tile. Bars breathe gently
 * (2.2s loop, staggered) and the tile gradient drifts (7s loop) — motion
 * is ambient, never attention-seeking. The global prefers-reduced-motion
 * blanket in globals.css stills both automatically.
 */
export function BrandMark({ size = 20 }: { size?: number }) {
  const bars = [
    { x: 2.5, delay: "0s" },
    { x: 7, delay: "-0.55s" },
    { x: 11.5, delay: "-1.1s" },
    { x: 16, delay: "-1.65s" },
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden
    >
      {bars.map((b) => (
        <rect
          key={b.x}
          x={b.x}
          y={4}
          width={3}
          height={14}
          rx={1.5}
          fill="white"
          fillOpacity={0.92}
          className="brand-eq-bar"
          style={{ animationDelay: b.delay }}
        />
      ))}
    </svg>
  );
}
