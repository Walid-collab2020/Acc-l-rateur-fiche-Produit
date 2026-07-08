"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { reportingApi } from "@/lib/api";
import { CheckCircle, XCircle, FileText, BarChart3 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";

// ── Pill statut ──
function DocPill({ present, presentLabel = "Reçu" }: { present: boolean; presentLabel?: string }) {
  return present
    ? <span className="inline-flex items-center gap-1 text-green-700 text-[11px] font-semibold bg-green-50 border border-green-200 px-2.5 py-0.5 rounded-full whitespace-nowrap"><CheckCircle className="w-3 h-3 shrink-0" /> {presentLabel}</span>
    : <span className="inline-flex items-center gap-1 text-[#DC2626] text-[11px] font-semibold bg-red-50 border border-red-200 px-2.5 py-0.5 rounded-full whitespace-nowrap"><XCircle className="w-3 h-3 shrink-0" /> Manquant</span>;
}

const DOC_COLS = [
  { key: "Conditions Générales",       label: "Conditions Générales",       color: "#16a34a" },
  { key: "Note Technique Actuarielle", label: "Note Technique Actuarielle", color: "#7C3AED" },
  { key: "Extraction BOSS",            label: "Extraction BOSS",            color: "#2563EB" },
];

// ── Couleurs statuts ──
const SC = {
  genere:        { color: "#6B7280", bg: "#F3F4F6", text: "#374151", border: "#D1D5DB", label: "Généré" },
  a_arbitrer_mh: { color: "#EA580C", bg: "#FFF7ED", text: "#EA580C", border: "#FED7AA", label: "Arbitrage MH" },
  voir_kapia:    { color: "#1D4ED8", bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE", label: "Voir KAPIA" },
  valide_metier: { color: "#15803D", bg: "#F0FDF4", text: "#15803D", border: "#BBF7D0", label: "Validé" },
};

function StatPill({ label, bg, text, border }: { label: string; bg: string; text: string; border: string }) {
  return (
    <span className="inline-block px-2.5 py-0.5 text-[11px] font-semibold rounded-full border"
      style={{ backgroundColor: bg, color: text, borderColor: border }}>
      {label}
    </span>
  );
}

export default function ReportingPage() {
  const [ficheFilter, setFicheFilter] = useState<number | "all">("all");

  const { data: portfolio } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => reportingApi.portfolio().then(r => r.data),
  });

  const { data: docCoverage = [], isLoading: loadingDocs } = useQuery({
    queryKey: ["doc-coverage"],
    queryFn: () => reportingApi.documents().then(r => r.data as any[]),
  });

  const { data: ficheStats = [] } = useQuery({
    queryKey: ["fiche-stats"],
    queryFn: () => reportingApi.ficheStats().then(r => r.data as any[]),
  });

  const totalProducts = (docCoverage as any[]).length || 0;

  // ── Doc coverage summary cards ──
  const docSummary = DOC_COLS.map(c => {
    const present = (docCoverage as any[]).filter((p: any) => (p.available_categories || []).includes(c.key)).length;
    return { ...c, present, total: totalProducts, pct: totalProducts > 0 ? Math.round((present / totalProducts) * 100) : 0 };
  });
  const fichePresentCount = (ficheStats as any[]).filter((f: any) => f.fiche_generated).length;
  const fichePct = totalProducts > 0 ? Math.round((fichePresentCount / totalProducts) * 100) : 0;

  // ── Fiche stats filtered ──
  const filteredFS = ficheFilter === "all"
    ? (ficheStats as any[]).filter((f: any) => f.total > 0)
    : (ficheStats as any[]).filter((f: any) => f.product_id === ficheFilter && f.total > 0);

  // ── Aggregated 4-bar chart data ──
  const ficheBarData = [
    { name: "Généré",       count: filteredFS.reduce((s: number, f: any) => s + (f.genere ?? 0), 0),        color: SC.genere.color },
    { name: "Arbitrage MH", count: filteredFS.reduce((s: number, f: any) => s + (f.a_arbitrer_mh ?? 0), 0), color: SC.a_arbitrer_mh.color },
    { name: "Voir KAPIA",   count: filteredFS.reduce((s: number, f: any) => s + (f.voir_kapia ?? 0), 0),    color: SC.voir_kapia.color },
    { name: "Validé",       count: filteredFS.reduce((s: number, f: any) => s + (f.valide_metier ?? 0), 0), color: SC.valide_metier.color },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-black">Reporting</h1>
        <p className="text-xs text-[#6A6A6A] mt-0.5">Avancement et qualité des migrations produit.</p>
      </div>

      {/* KPIs */}
      {portfolio && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card text-center py-5">
            <p className="text-xs text-[#6A6A6A] mb-1">Total produits</p>
            <p className="text-3xl font-bold text-black">{portfolio.kpis.total_products}</p>
          </div>
          <div className="card text-center py-5">
            <p className="text-xs text-[#6A6A6A] mb-1">Fiches validées</p>
            <p className="text-3xl font-bold text-[#15803D]">{portfolio.kpis.products_validated_fiche}</p>
            <p className="text-[10px] text-[#9A9A9A] mt-0.5">sur {portfolio.kpis.total_products}</p>
          </div>
          <div className="card text-center py-5">
            <p className="text-xs text-[#6A6A6A] mb-1">Paramétrage validé</p>
            <p className="text-3xl font-bold text-[#1D4ED8]">{portfolio.kpis.products_validated_parametrage}</p>
            <p className="text-[10px] text-[#9A9A9A] mt-0.5">sur {portfolio.kpis.total_products}</p>
          </div>
        </div>
      )}

      {/* ── Documents par produit ── */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-4 h-4 text-[#A100FF]" />
          <h2 className="font-semibold text-black text-sm">Documents par produit</h2>
        </div>

        {/* Jauge % par type de document */}
        {totalProducts > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-5">
            {docSummary.map(d => (
              <div key={d.key} className="border border-[#E0E0E0] px-4 py-3 rounded-lg bg-[#FAFAFA]">
                <p className="text-[11px] font-medium text-[#6A6A6A] mb-2 truncate" title={d.label}>{d.label}</p>
                <p className="text-2xl font-bold text-black leading-none">
                  {d.present}<span className="text-sm font-normal text-[#9A9A9A]">/{d.total}</span>
                </p>
                <div className="mt-2 h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${d.pct}%`, backgroundColor: d.color }} />
                </div>
                <p className="text-[11px] font-semibold text-right mt-1" style={{ color: d.color }}>{d.pct}%</p>
              </div>
            ))}
            <div className="border border-[#E0E0E0] px-4 py-3 rounded-lg bg-[#FAFAFA]">
              <p className="text-[11px] font-medium text-[#6A6A6A] mb-2">Fiche Produit générée</p>
              <p className="text-2xl font-bold text-black leading-none">
                {fichePresentCount}<span className="text-sm font-normal text-[#9A9A9A]">/{totalProducts}</span>
              </p>
              <div className="mt-2 h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all bg-[#A100FF]" style={{ width: `${fichePct}%` }} />
              </div>
              <p className="text-[11px] font-semibold text-right mt-1 text-[#A100FF]">{fichePct}%</p>
            </div>
          </div>
        )}

        {loadingDocs ? (
          <div className="text-center py-6 text-[#6A6A6A] text-sm">Chargement…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E0E0E0] bg-[#F2F2F2]">
                  <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Produit</th>
                  {DOC_COLS.map(c => (
                    <th key={c.key} className="text-center px-3 py-2 font-medium text-[#6A6A6A] text-xs">{c.label}</th>
                  ))}
                  <th className="text-center px-3 py-2 font-medium text-[#6A6A6A] text-xs">Fiche Produit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F2F2]">
                {(docCoverage as any[]).map((p: any) => {
                  const available: string[] = p.available_categories || [];
                  const ficheRow = (ficheStats as any[]).find((f: any) => f.product_id === p.product_id);
                  const productLabel = p.boss_number + (p.name ? `_${p.name.replace(/\s+/g, "_")}` : "");
                  return (
                    <tr key={p.product_id} className="hover:bg-[#FAFAFA]">
                      <td className="px-3 py-2.5 font-mono font-semibold text-[#A100FF] whitespace-nowrap">{productLabel}</td>
                      {DOC_COLS.map(c => (
                        <td key={c.key} className="px-3 py-2.5 text-center">
                          <DocPill present={available.includes(c.key)} />
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-center">
                        <DocPill present={ficheRow?.fiche_generated ?? false} presentLabel="Générée" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Champs Fiche Produit par statut ── */}
      {(ficheStats as any[]).some((f: any) => f.total > 0) && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#A100FF]" />
              <h2 className="font-semibold text-black text-sm">Champs Fiche Produit par statut</h2>
            </div>
            {/* Filtre produit */}
            <select
              value={ficheFilter === "all" ? "all" : String(ficheFilter)}
              onChange={e => setFicheFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="text-xs border border-[#E0E0E0] px-2 py-1 bg-white text-[#3D3D3D] focus:outline-none focus:border-[#A100FF] rounded"
            >
              <option value="all">Tous les produits</option>
              {(ficheStats as any[]).filter((f: any) => f.total > 0).map((f: any) => (
                <option key={f.product_id} value={f.product_id}>
                  {f.boss_number}{f.name ? `_${f.name.replace(/\s+/g, "_")}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Graphique 4 barres */}
          <div className="mb-5">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={ficheBarData} barSize={48} margin={{ top: 16, right: 24, left: -10, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12, fontWeight: 500 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: "#F9FAFB" }} />
                <Bar dataKey="count" name="Champs" radius={[6, 6, 0, 0]}>
                  {ficheBarData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                  <LabelList dataKey="count" position="top" style={{ fontSize: 12, fontWeight: 700, fill: "#374151" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Tableau */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E0E0E0] bg-[#F2F2F2]">
                  <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Produit</th>
                  <th className="text-center px-3 py-2 font-medium text-[#6A6A6A]">Version</th>
                  <th className="text-center px-3 py-2 font-medium text-[#6A6A6A]">Total</th>
                  <th className="text-center px-3 py-2">
                    <StatPill {...SC.genere} />
                  </th>
                  <th className="text-center px-3 py-2">
                    <StatPill {...SC.a_arbitrer_mh} />
                  </th>
                  <th className="text-center px-3 py-2">
                    <StatPill {...SC.voir_kapia} />
                  </th>
                  <th className="text-center px-3 py-2">
                    <StatPill {...SC.valide_metier} />
                  </th>
                  <th className="text-right px-3 py-2 font-medium text-[#6A6A6A]">% Validé</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F2F2]">
                {filteredFS.map((f: any) => {
                  const pct = f.total > 0 ? Math.round((f.valide_metier / f.total) * 100) : 0;
                  const productLabel = f.boss_number + (f.name ? `_${f.name.replace(/\s+/g, "_")}` : "");
                  return (
                    <tr key={f.product_id} className="hover:bg-[#FAFAFA]">
                      <td className="px-3 py-2.5 font-mono font-semibold text-[#A100FF] whitespace-nowrap">{productLabel}</td>
                      <td className="px-3 py-2.5 text-center">
                        {f.version != null
                          ? <span className="text-[11px] bg-[#F3E0FF] text-[#A100FF] px-2 py-0.5 rounded-full font-semibold">V{f.version}</span>
                          : <span className="text-[#BDBDBD]">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center font-bold text-black">{f.total}</td>
                      <td className="px-3 py-2.5 text-center font-semibold text-[#374151]">{f.genere ?? 0}</td>
                      <td className="px-3 py-2.5 text-center font-semibold text-[#EA580C]">{f.a_arbitrer_mh ?? 0}</td>
                      <td className="px-3 py-2.5 text-center font-semibold text-[#1D4ED8]">{f.voir_kapia ?? 0}</td>
                      <td className="px-3 py-2.5 text-center font-semibold text-[#15803D]">{f.valide_metier ?? 0}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 h-2 bg-[#E5E7EB] overflow-hidden rounded-full">
                            <div className="h-full bg-[#15803D] transition-all rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className={`text-xs font-bold ${pct === 100 ? "text-[#15803D]" : pct > 0 ? "text-[#1D4ED8]" : "text-[#9A9A9A]"}`}>
                            {pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* Ligne totaux */}
                {filteredFS.length > 1 && (() => {
                  const totGen = filteredFS.reduce((s: number, f: any) => s + (f.genere ?? 0), 0);
                  const totArb = filteredFS.reduce((s: number, f: any) => s + (f.a_arbitrer_mh ?? 0), 0);
                  const totKap = filteredFS.reduce((s: number, f: any) => s + (f.voir_kapia ?? 0), 0);
                  const totVal = filteredFS.reduce((s: number, f: any) => s + (f.valide_metier ?? 0), 0);
                  const totAll = filteredFS.reduce((s: number, f: any) => s + (f.total ?? 0), 0);
                  const pctAll = totAll > 0 ? Math.round((totVal / totAll) * 100) : 0;
                  return (
                    <tr className="bg-[#F2F2F2] border-t-2 border-[#D0D0D0] font-bold">
                      <td className="px-3 py-2 text-[#6A6A6A] text-xs uppercase tracking-wide" colSpan={2}>Total</td>
                      <td className="px-3 py-2 text-center text-black">{totAll}</td>
                      <td className="px-3 py-2 text-center text-[#374151]">{totGen}</td>
                      <td className="px-3 py-2 text-center text-[#EA580C]">{totArb}</td>
                      <td className="px-3 py-2 text-center text-[#1D4ED8]">{totKap}</td>
                      <td className="px-3 py-2 text-center text-[#15803D]">{totVal}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`text-xs font-bold ${pctAll === 100 ? "text-[#15803D]" : "text-[#1D4ED8]"}`}>{pctAll}%</span>
                      </td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
