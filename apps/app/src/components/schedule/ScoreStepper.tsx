interface ScoreStepperProps {
  label: string;
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  disabled: boolean;
}

export function ScoreStepper({ label, value, onDecrease, onIncrease, disabled }: ScoreStepperProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-2">
      <div className="mb-2 text-center text-xs font-black uppercase tracking-[0.04em] text-gray-500">{label}</div>
      <div className="flex items-center justify-center gap-3">
        <button type="button" className="min-h-11 min-w-11 rounded-full border border-gray-200 text-xl font-black text-gray-700 disabled:opacity-40" onClick={onDecrease} disabled={disabled || value <= 0} aria-label={`${label} score down`}>−</button>
        <div className="min-w-12 text-center text-3xl font-black tabular-nums text-gray-950">{value}</div>
        <button type="button" className="min-h-11 min-w-11 rounded-full border border-gray-200 text-xl font-black text-gray-700 disabled:opacity-40" onClick={onIncrease} disabled={disabled} aria-label={`${label} score up`}>+</button>
      </div>
    </div>
  );
}
