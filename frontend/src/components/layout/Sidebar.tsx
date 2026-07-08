"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderOpen, CheckSquare, BarChart3, Sparkles, GitCompare, ShieldCheck,
} from "lucide-react";
import clsx from "clsx";

const navigation = [
  { name: "Documentation",      href: "/documents",        icon: FolderOpen,   badge: "1", disabled: false },
  { name: "Fiche produit",      href: "/fiche2",           icon: Sparkles,     badge: "2", disabled: false },
  { name: "Recette paramétrage",href: "/recette",          icon: CheckSquare,  badge: "3", disabled: false },
  { name: "Recette de non-régression", href: "/non-regression", icon: GitCompare, badge: "4", disabled: false },
  { name: "Analyse de conformité",     href: "/conformite",    icon: ShieldCheck, badge: "5", disabled: true },
  { name: "Reporting",          href: "/reporting",        icon: BarChart3,    badge: "6", disabled: false },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-white flex flex-col h-screen fixed left-0 top-0 z-30 border-r border-[#E0E0E0]">
      {/* Logo / brand */}
      <div className="px-6 py-5 border-b border-[#E0E0E0]">
        <div className="flex items-center gap-2">
          {/* Accenture ">" mark */}
          <span className="text-[#A100FF] font-bold text-2xl leading-none select-none">&gt;</span>
          <div>
            <div className="text-sm font-semibold text-black leading-tight">Accélérateur Produit KELIA</div>
            <div className="text-xs text-[#6A6A6A] mt-0.5">Fiche produit &amp; Recette</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {navigation.map((item) => {
          const active = !item.disabled && (pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href)));
          if (item.disabled) {
            return (
              <div
                key={item.name}
                title="Prochainement disponible"
                className="flex items-center gap-3 px-3 py-2.5 mb-0.5 text-sm opacity-35 cursor-not-allowed select-none"
              >
                <item.icon className="w-4 h-4 shrink-0 text-[#9A9A9A]" />
                <span className="flex-1 truncate text-[#9A9A9A]">{item.name}</span>
                {item.badge && (
                  <span className="text-xs px-1.5 py-0.5 font-normal shrink-0 bg-[#F2F2F2] text-[#9A9A9A]">
                    {item.badge}
                  </span>
                )}
              </div>
            );
          }
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2.5 mb-0.5 text-sm transition-colors group relative",
                active
                  ? "bg-[#F3E0FF] text-[#A100FF] font-semibold"
                  : "text-black font-normal hover:bg-[#F2F2F2] hover:text-black"
              )}
            >
              {active && (
                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#A100FF]" />
              )}
              <item.icon className={clsx("w-4 h-4 shrink-0", active ? "text-[#A100FF]" : "text-[#6A6A6A]")} />
              <span className="flex-1 truncate">{item.name}</span>
              {item.badge && (
                <span className={clsx(
                  "text-xs px-1.5 py-0.5 font-normal shrink-0",
                  active ? "bg-[#A100FF] text-white" : "bg-[#F2F2F2] text-[#6A6A6A]"
                )}>
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}

      </nav>

    </aside>
  );
}
