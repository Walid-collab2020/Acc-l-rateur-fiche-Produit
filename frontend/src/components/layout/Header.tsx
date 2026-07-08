"use client";
interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#E0E0E0]">
      <div>
        <h1 className="text-2xl font-semibold text-black">{title}</h1>
        {subtitle && <p className="text-sm text-[#6A6A6A] mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
