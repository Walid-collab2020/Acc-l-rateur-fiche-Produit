import clsx from "clsx";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  "Non démarré":      { label: "Non démarré",      className: "bg-[#F2F2F2] text-[#6A6A6A]" },
  "En cours":         { label: "En cours",          className: "bg-[#F3E0FF] text-[#7700CC]" },
  "Généré":           { label: "Généré",            className: "bg-[#F3E0FF] text-[#A100FF]" },
  "Validé":           { label: "Validé",            className: "bg-green-50 text-green-700" },
  "Rejeté":           { label: "Rejeté",            className: "bg-red-50 text-[#FF3333]" },
  "Conforme":         { label: "Conforme",          className: "bg-green-50 text-green-700" },
  "Écart":            { label: "Écart",             className: "bg-red-50 text-[#FF3333]" },
  "Manquant":         { label: "Manquant",          className: "bg-yellow-50 text-yellow-700" },
  "Supplémentaire":   { label: "Supplémentaire",    className: "bg-orange-50 text-orange-700" },
  "Non contrôlable":  { label: "Non contrôlable",   className: "bg-[#F2F2F2] text-[#6A6A6A]" },
  "Ouverte":          { label: "Ouverte",           className: "bg-red-50 text-[#FF3333]" },
  "En analyse":       { label: "En analyse",        className: "bg-yellow-50 text-yellow-700" },
  "Corrigée":         { label: "Corrigée",          className: "bg-[#F3E0FF] text-[#7700CC]" },
  "Clôturée":         { label: "Clôturée",          className: "bg-[#F2F2F2] text-[#6A6A6A]" },
};

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] || { label: status, className: "bg-[#F2F2F2] text-[#6A6A6A]" };
  return (
    <span className={clsx(
      "inline-flex items-center font-medium",
      size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
      config.className
    )}>
      {config.label}
    </span>
  );
}
