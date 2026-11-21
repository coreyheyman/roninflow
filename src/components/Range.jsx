// A slim slider: a thin track filled up to the value, and a round thumb that grows a little when you grab it.
export default function Range({ value, min = 0, max = 100, step = 1, onChange, className = '', style, ...rest }) {
  const pct = ((Number(value) - min) / (max - min || 1)) * 100;
  return (
    <input
      type="range" className={`rf-range ${className}`} min={min} max={max} step={step} value={value}
      style={{ ...style, '--pct': `${Math.max(0, Math.min(100, pct))}%` }}
      onChange={(e) => onChange?.(Number(e.target.value), e)}
      {...rest}
    />
  );
}
