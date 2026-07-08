import clsx from "clsx";

interface ConfidenceBarProps {
  value?: number | null;
  showLabel?: boolean;
}

export function ConfidenceBar({ value, showLabel = true }: ConfidenceBarProps) {
  if (value == null) return <span className="text-[#6A6A6A] text-xs">—</span>;
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-400" : "bg-[#FF3333]";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-[#E0E0E0] overflow-hidden">
        <div className={clsx("h-full", color)} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && <span className="text-xs text-[#6A6A6A]">{pct}%</span>}
    </div>
  );
}
