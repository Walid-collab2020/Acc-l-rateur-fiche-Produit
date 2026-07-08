interface KPICardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: "blue" | "green" | "red" | "yellow" | "purple";
  icon?: React.ReactNode;
}

const COLORS = {
  blue:   "bg-white border-l-4 border-l-[#A100FF] text-black",
  green:  "bg-white border-l-4 border-l-green-500 text-black",
  red:    "bg-white border-l-4 border-l-[#FF3333] text-black",
  yellow: "bg-white border-l-4 border-l-yellow-400 text-black",
  purple: "bg-white border-l-4 border-l-[#A100FF] text-black",
};

export function KPICard({ label, value, sub, color = "blue", icon }: KPICardProps) {
  return (
    <div className={`border border-[#E0E0E0] p-5 ${COLORS[color]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-[#6A6A6A] uppercase tracking-wide">{label}</p>
          <p className="text-3xl font-semibold text-black mt-1">{value}</p>
          {sub && <p className="text-xs mt-1 text-[#6A6A6A]">{sub}</p>}
        </div>
        {icon && <div className="text-[#E0E0E0]">{icon}</div>}
      </div>
    </div>
  );
}
