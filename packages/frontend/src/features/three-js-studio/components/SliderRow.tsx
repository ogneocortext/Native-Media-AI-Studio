interface SliderRowProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  displayDecimals?: number;
}

export function SliderRow({ label, min, max, step, value, onChange, displayDecimals = 2 }: SliderRowProps) {
  return (
    <div>
      <div className="flex justify-between text-gray-400 mb-1">
        <span>{label}</span>
        <span className="font-mono text-purple-400">{value.toFixed(displayDecimals)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-purple-500" />
    </div>
  );
}
