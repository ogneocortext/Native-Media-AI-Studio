/**
 * ToggleSwitch — accessible toggle switch component.
 *
 * Extracts the inline toggle markup used in multiple places (ToggleRow,
 * PushNotificationRow) into a single reusable component so style changes
 * ripple everywhere.
 */

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  disabled?: boolean;
}

export function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: ToggleSwitchProps) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        className="sr-only peer"
        aria-label={ariaLabel}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <div
        className={`w-11 h-6 rounded-full peer-focus:outline-none peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all ${checked ? "bg-primary" : "bg-gray-700"}`}
        role="switch"
        aria-checked={checked}
      />
    </label>
  );
}