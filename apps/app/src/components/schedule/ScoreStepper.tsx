interface ScoreStepperProps {
  label: string;
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  disabled: boolean;
  compact?: boolean;
  controlLabel?: string;
}

export function ScoreStepper({ label, value, onDecrease, onIncrease, disabled, compact = false, controlLabel }: ScoreStepperProps) {
  const accessibleLabel = controlLabel || label;
  return (
    <div className={`rounded-xl border border-gray-200 bg-white ${compact ? 'p-1.5' : 'p-2'}`}>
      <div className={`${compact ? 'mb-1' : 'mb-2'} text-center text-xs font-black uppercase tracking-[0.04em] text-gray-500`}>{label}</div>
      <div className={`flex items-center justify-center ${compact ? 'gap-1' : 'gap-3'}`}>
        <button type="button" className="min-h-11 min-w-11 rounded-full border border-gray-200 text-xl font-black text-gray-700 disabled:opacity-40" onClick={onDecrease} disabled={disabled || value <= 0} aria-label={`${accessibleLabel} score down`}>−</button>
        <div className={`${compact ? 'min-w-8 text-2xl' : 'min-w-12 text-3xl'} text-center font-black tabular-nums text-gray-950`}>{value}</div>
        <button type="button" className="min-h-11 min-w-11 rounded-full border border-gray-200 text-xl font-black text-gray-700 disabled:opacity-40" onClick={onIncrease} disabled={disabled} aria-label={`${accessibleLabel} score up`}>+</button>
      </div>
    </div>
  );
}
