import { memo } from "react";

export const SpectrumBar = memo(function SpectrumBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(value, 1);
  const now = Math.round(pct * 100);
  return (
    <div className="spec-row" role="meter" aria-label={`${label} level`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={now}>
      <span className="spec-label" aria-hidden="true">{label}</span>
      <div className="spec-track" aria-hidden="true">
        <div className="spec-fill" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <span className="spec-value" aria-hidden="true">{now}</span>
    </div>
  );
});
