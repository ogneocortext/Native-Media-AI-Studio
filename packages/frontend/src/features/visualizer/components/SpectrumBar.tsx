import { memo } from "react";

export const SpectrumBar = memo(function SpectrumBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(value, 1);
  return (
    <div className="spec-row">
      <span className="spec-label">{label}</span>
      <div className="spec-track">
        <div className="spec-fill" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <span className="spec-value">{Math.round(pct * 100)}</span>
    </div>
  );
});
