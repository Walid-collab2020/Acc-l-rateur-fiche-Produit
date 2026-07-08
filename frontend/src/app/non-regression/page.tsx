"use client";
import { useState, useMemo, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Upload, FileText, GitCompare, Loader2, Trash2, Sparkles,
  ArrowRight, Eye, EyeOff, History, Filter, X, MessageSquare,
} from "lucide-react";
import {
  nonRegressionApi, productsApi, reportingApi,
  type NRResult, type NRItem, type NRHistoryEntry, type Product, type RecetteAnnotation,
} from "@/lib/api";

// ── Statuts métier (harmonisé avec fiche produit) ─────────────────────────────
const USER_STATUS_CFG: Record<string, { label: string; activeCls: string; inactiveCls: string; badgeCls: string }> = {
  genere:        { label: "Généré",       activeCls: "bg-[#6B7280] text-white",   inactiveCls: "bg-[#F3F4F6] text-[#9CA3AF] border border-[#E5E7EB] hover:bg-[#E5E7EB]",   badgeCls: "bg-[#F3F4F6] text-[#374151] border-[#D1D5DB]" },
  a_arbitrer_mh: { label: "Arbitrage MH", activeCls: "bg-[#D97706] text-white",   inactiveCls: "bg-[#FFF7ED] text-[#FCA574] border border-[#FED7AA] hover:bg-[#FFEDD5]",   badgeCls: "bg-[#FFF7ED] text-[#D97706] border-[#FED7AA]" },
  valide_metier: { label: "Validé",       activeCls: "bg-[#16A34A] text-white",   inactiveCls: "bg-[#F0FDF4] text-[#86EFAC] border border-[#BBF7D0] hover:bg-[#DCFCE7]",   badgeCls: "bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]" },
  voir_kapia:    { label: "Voir KAPIA",   activeCls: "bg-[#2563EB] text-white",   inactiveCls: "bg-[#EFF6FF] text-[#93C5FD] border border-[#BFDBFE] hover:bg-[#DBEAFE]",   badgeCls: "bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]" },
};

const STATUS_BTNS = [
  { key: "genere",        label: "Généré" },
  { key: "a_arbitrer_mh", label: "Arbitrage MH" },
  { key: "valide_metier", label: "Validé" },
  { key: "voir_kapia",    label: "Voir KAPIA" },
];

const STATUS_CFG = {
  conforme:  { label: "Stable",   fill: "#22c55e", bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200"  },
  ecart:     { label: "Modifié",  fill: "#eab308", bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" },
  nouveau:   { label: "Ajouté",   fill: "#3b82f6", bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200"   },
  supprime:  { label: "Supprimé", fill: "#ef4444", bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200"    },
} as const;
type SKey = keyof typeof STATUS_CFG;

const MODEL_OPTIONS = [
  { value: "openai-gpt5", label: "GPT-5" },
  { value: "anthropic",   label: "Claude Sonnet 4.6" },
  { value: "openai",      label: "GPT-4o" },
];

// ── Composants ────────────────────────────────────────────────────────────────
function ValidateButton({ productId, module }: { productId: number; module: string }) {
  const [validated, setValidated] = useState(false);
  const mut = useMutation({
    mutationFn: () => reportingApi.validateModule(productId, module),
    onSuccess: () => setValidated(true),
  });
  if (validated) {
    return <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5">✓ Validé</span>;
  }
  return (
    <button onClick={() => mut.mutate()} disabled={mut.isPending}
      className="btn-primary text-xs disabled:opacity-50 flex items-center gap-1.5">
      {mut.isPending ? "…" : "Valider la recette"}
    </button>
  );
}

function IAStatusBadge({ status }: { status: SKey }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.conforme;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium border ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
    </span>
  );
}

function FileUpload({ label, accept, file, onChange, tag, color }: {
  label: string; accept: string; file: File | null;
  onChange: (f: File | null) => void; tag: string; color: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div onClick={() => ref.current?.click()}
      className={`flex items-center gap-3 border-2 border-dashed px-4 py-4 cursor-pointer transition-colors ${
        file ? "border-[#A100FF] bg-[#F9F6FF]" : "border-[#E0E0E0] hover:border-[#A100FF]/50"
      }`}>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => onChange(e.target.files?.[0] ?? null)} />
      <span className={`text-[11px] px-2 py-0.5 font-bold shrink-0 ${color}`}>{tag}</span>
      {file ? (
        <>
          <FileText className="w-4 h-4 text-[#A100FF] shrink-0" />
          <div>
            <div className="text-xs text-[#A100FF] font-medium truncate max-w-[220px]">{file.name}</div>
            <div className="text-[10px] text-[#6A6A6A]">{(file.size / 1024).toFixed(0)} Ko</div>
          </div>
        </>
      ) : (
        <>
          <Upload className="w-4 h-4 text-[#6A6A6A] shrink-0" />
          <div>
            <div className="text-xs text-[#6A6A6A] font-medium">{label}</div>
            <div className="text-[10px] text-[#9ca3af]">Excel (.xlsx) ou CSV</div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function NonRegressionPage() {
  const [productId, setProductId]           = useState<number | null>(null);
  const [fileV1, setFileV1]                 = useState<File | null>(null);
  const [fileV2, setFileV2]                 = useState<File | null>(null);
  const [provider, setProvider]             = useState("openai-gpt5");
  const [result, setResult]                 = useState<NRResult | null>(null);
  const [filterStatus, setFilterStatus]     = useState<string>("");
  const [filterDecision, setFilterDecision] = useState<string>("");
  const [expandedRows, setExpandedRows]     = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory]       = useState(false);
  const [selectedRows, setSelectedRows]     = useState<Set<number>>(new Set());
  const [annotations, setAnnotations]       = useState<Record<string, RecetteAnnotation>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => productsApi.list().then(r => r.data),
  });
  const { data: historyList = [], refetch: refetchHistory } = useQuery<NRHistoryEntry[]>({
    queryKey: ["nonreg-history", productId],
    queryFn: () => nonRegressionApi.historyList(productId!).then(r => r.data),
    enabled: !!productId,
  });

  const mutation = useMutation({
    mutationFn: () => nonRegressionApi.compare(fileV1!, fileV2!, provider, productId!).then(r => r.data),
    onSuccess: (data) => {
      setResult(data);
      setAnnotations(data.annotations ?? {});
      setFilterStatus("");
      setFilterDecision("");
      setExpandedRows(new Set());
      setSelectedRows(new Set());
      refetchHistory();
    },
  });

  const canRun = !!productId && !!fileV1 && !!fileV2;

  const saveAnnotations = useCallback((updated: Record<string, RecetteAnnotation>, historyId?: number) => {
    const id = historyId ?? result?.history_id;
    if (!id) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      nonRegressionApi.updateAnnotations(id, updated);
    }, 600);
  }, [result?.history_id]);

  const updateAnnotation = (index: number, patch: Partial<RecetteAnnotation>) => {
    setAnnotations(prev => {
      const cur = prev[String(index)] ?? { user_status: "genere", user_comment: "" };
      const next = { ...prev, [String(index)]: { ...cur, ...patch } };
      saveAnnotations(next);
      return next;
    });
  };

  async function loadHistory(id: number) {
    const r = await nonRegressionApi.historyDetail(id);
    setResult(r.data as NRResult);
    setAnnotations((r.data as NRResult).annotations ?? {});
    setFilterStatus("");
    setFilterDecision("");
    setExpandedRows(new Set());
    setSelectedRows(new Set());
    setShowHistory(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const toggleRow = (key: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const filtered = useMemo<NRItem[]>(() => {
    if (!result) return [];
    return result.items.filter((item, i) => {
      if (filterStatus === "critiques") {
        if (item.status === "conforme" || (item.criticite !== "critique" && item.criticite !== "élevé")) return false;
      } else if (filterStatus) {
        if (item.status !== filterStatus) return false;
      }
      if (filterDecision) {
        const us = annotations[String(i)]?.user_status || "genere";
        if (us !== filterDecision) return false;
      }
      return true;
    });
  }, [result, filterStatus, filterDecision, annotations]);

  const decisionCounts = useMemo(() => {
    if (!result) return {} as Record<string, number>;
    const counts: Record<string, number> = { genere: 0, a_arbitrer_mh: 0, valide_metier: 0, voir_kapia: 0 };
    result.items.forEach((_, i) => {
      const us = annotations[String(i)]?.user_status || "genere";
      if (us in counts) counts[us]++;
      else counts.genere++;
    });
    return counts;
  }, [result, annotations]);

  const allFilteredIndexes = useMemo(() => {
    if (!result) return [];
    return result.items.reduce<number[]>((acc, item, i) => {
      if (filterStatus === "critiques") {
        if (item.status === "conforme" || (item.criticite !== "critique" && item.criticite !== "élevé")) return acc;
      } else if (filterStatus) {
        if (item.status !== filterStatus) return acc;
      }
      if (filterDecision) {
        const us = annotations[String(i)]?.user_status || "genere";
        if (us !== filterDecision) return acc;
      }
      acc.push(i);
      return acc;
    }, []);
  }, [result, filterStatus, filterDecision, annotations]);

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  return (
    <div className="p-6 space-y-5">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-black">Analyse de non-régression</h1>
          <p className="text-xs text-[#6A6A6A] mt-0.5">
            Compare deux versions du fichier paramétrage KELIA — détecte toutes les régressions par analyse IA.
          </p>
        </div>
        {productId && historyList.length > 0 && (
          <button onClick={() => setShowHistory(v => !v)}
            className="flex items-center gap-1.5 text-xs text-[#A100FF] border border-[#A100FF]/30 px-3 py-1.5 hover:bg-[#F9F6FF]">
            <History className="w-3.5 h-3.5"/>Historique ({historyList.length})
          </button>
        )}
      </div>

      {/* Sélecteur produit */}
      <div className="card">
        <label className="block text-xs font-semibold text-[#6A6A6A] mb-2 uppercase tracking-wide">Produit</label>
        <select value={productId ?? ""} onChange={e => setProductId(e.target.value ? Number(e.target.value) : null)}
          className="border border-[#E0E0E0] px-3 py-2 text-sm w-80 focus:outline-none focus:border-[#A100FF]">
          <option value="">— Sélectionner un produit —</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>BOSS {p.boss_number}{p.name ? ` — ${p.name}` : ""}</option>
          ))}
        </select>
      </div>

      {/* Historique */}
      {showHistory && productId && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-black">Historique des analyses</h3>
            <button onClick={() => setShowHistory(false)} className="text-[10px] text-[#6A6A6A] hover:text-black">✕</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#FAFAFA] text-[#6A6A6A] border-b border-[#E0E0E0]">
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Fichier V1</th>
                  <th className="text-left px-3 py-2">Fichier V2</th>
                  <th className="text-left px-3 py-2">V1 lignes</th>
                  <th className="text-left px-3 py-2">V2 lignes</th>
                  <th className="text-left px-3 py-2">Taux stable</th>
                  <th className="text-right px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F2F2]">
                {historyList.map(h => (
                  <tr key={h.id} className="hover:bg-[#F9F6FF]">
                    <td className="px-3 py-1.5 text-[#6A6A6A]">
                      {h.created_at ? new Date(h.created_at).toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit" }) : "—"}
                    </td>
                    <td className="px-3 py-1.5 max-w-[160px] truncate">{h.filename_v1}</td>
                    <td className="px-3 py-1.5 max-w-[160px] truncate">{h.filename_v2}</td>
                    <td className="px-3 py-1.5">{h.v1_rows}</td>
                    <td className="px-3 py-1.5">{h.v2_rows}</td>
                    <td className="px-3 py-1.5 font-semibold text-[#A100FF]">{h.taux_stable}%</td>
                    <td className="px-3 py-1.5 text-right flex items-center gap-2 justify-end">
                      <button onClick={() => loadHistory(h.id)}
                        className="text-[10px] text-[#A100FF] hover:underline font-medium">Charger</button>
                      <a href={`${API_URL}/non-regression/history/${h.id}/export`}
                        target="_blank" rel="noreferrer"
                        className="text-[10px] text-[#6A6A6A] hover:text-[#A100FF] hover:underline">Excel</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Configuration */}
      <div className="card space-y-4">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-semibold text-[#6A6A6A] mb-1.5 uppercase tracking-wide">Version de référence (V1)</label>
            <FileUpload label="Fichier paramétrage V1" accept=".xlsx,.xls,.xlsm,.csv"
              file={fileV1} onChange={setFileV1}
              tag="V1" color="bg-[#F2F2F2] text-[#6A6A6A] border border-[#E0E0E0]" />
            {fileV1 && (
              <button onClick={() => setFileV1(null)}
                className="mt-1 text-[10px] text-[#6A6A6A] hover:text-red-600 flex items-center gap-1">
                <Trash2 className="w-3 h-3" />Retirer
              </button>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#6A6A6A] mb-1.5 uppercase tracking-wide">Nouvelle version (V2)</label>
            <FileUpload label="Fichier paramétrage V2" accept=".xlsx,.xls,.xlsm,.csv"
              file={fileV2} onChange={setFileV2}
              tag="V2" color="bg-[#F3E0FF] text-[#A100FF]" />
            {fileV2 && (
              <button onClick={() => setFileV2(null)}
                className="mt-1 text-[10px] text-[#6A6A6A] hover:text-red-600 flex items-center gap-1">
                <Trash2 className="w-3 h-3" />Retirer
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div>
            <label className="block text-xs font-medium text-[#6A6A6A] mb-1.5">Modèle LLM</label>
            <select value={provider} onChange={e => setProvider(e.target.value)}
              className="border border-[#E0E0E0] px-3 py-2 text-sm focus:outline-none focus:border-[#A100FF]">
              {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <button onClick={() => mutation.mutate()} disabled={!canRun || mutation.isPending || !productId}
            className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50 ml-auto h-[38px] px-6">
            {mutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" />Analyse en cours…</>
              : <><GitCompare className="w-4 h-4" />Lancer l&apos;analyse de non-régression</>}
          </button>
        </div>
        {mutation.isError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2">
            Erreur : {String((mutation.error as Error)?.message)}
          </p>
        )}
      </div>

      {/* Résultats */}
      {result && (
        <div className="space-y-4">
          {/* Fichiers comparés */}
          <div className="flex items-center gap-3">
            <span className="bg-[#F2F2F2] border border-[#E0E0E0] px-3 py-1.5 font-mono text-xs">V1 — {result.v1_name}</span>
            <ArrowRight className="w-4 h-4 text-[#A100FF]" />
            <span className="bg-[#F3E0FF] border border-[#E0CCFF] text-[#A100FF] px-3 py-1.5 font-mono text-xs">V2 — {result.v2_name}</span>
          </div>

          {/* KPI + Valider */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-3 flex-wrap">
              {(["conforme", "ecart", "nouveau", "supprime"] as SKey[]).map(k => (
                <div key={k} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border ${STATUS_CFG[k].bg} ${STATUS_CFG[k].text} ${STATUS_CFG[k].border}`}>
                  <span className="font-bold">{result.summary[k]}</span>
                  <span>{STATUS_CFG[k].label}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs border bg-[#F9F6FF] border-[#A100FF]/20 text-[#A100FF]">
                <span className="font-bold">{result.v1_count}</span><span>→</span><span className="font-bold">{result.v2_count}</span>
                <span>params</span>
              </div>
            </div>
            {productId && <ValidateButton productId={productId} module="parametrage" />}
          </div>

          {/* Décisions métier */}
          <div className="card">
            <div className="text-xs font-semibold text-[#6A6A6A] mb-3">Décisions métier</div>
            <div className="flex gap-3 flex-wrap">
              {STATUS_BTNS.map(({ key, label }) => {
                const cfg = USER_STATUS_CFG[key];
                const count = decisionCounts[key] ?? 0;
                return (
                  <div key={key} className={`flex items-center gap-2 px-3 py-2 border text-xs ${cfg.badgeCls}`}>
                    <span>{label}</span>
                    <span className="font-bold text-sm">{count}</span>
                  </div>
                );
              })}
              <div className="flex items-center gap-1.5 px-3 py-2 border border-[#E0E0E0] text-xs text-[#6A6A6A]">
                Total : <span className="font-bold ml-1">{result.items.length}</span>
              </div>
            </div>
          </div>

          {/* Filtres */}
          <div className="card p-0">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-[#E0E0E0] bg-[#FAFAFA] flex-wrap">
              <Filter className="w-3.5 h-3.5 text-[#6A6A6A] shrink-0"/>
              <span className="text-xs text-[#6A6A6A] shrink-0">Statut IA :</span>
              {(["", "ecart", "nouveau", "supprime", "conforme"] as (string | SKey)[]).map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`text-xs px-2 py-0.5 transition-colors shrink-0 ${filterStatus === s ? "bg-[#A100FF] text-white" : "bg-[#F2F2F2] text-[#6A6A6A] hover:bg-[#E0E0E0]"}`}>
                  {s === "" ? "Tous" : STATUS_CFG[s as SKey]?.label}
                  {s !== "" && ` (${result.summary[s as SKey] ?? 0})`}
                </button>
              ))}
              <span className="text-[#D0D0D0]">|</span>
              <span className="text-xs text-[#6A6A6A] shrink-0">Décision :</span>
              {["", ...STATUS_BTNS.map(b => b.key)].map(s => (
                <button key={s} onClick={() => setFilterDecision(s)}
                  className={`text-xs px-2 py-0.5 transition-colors shrink-0 ${filterDecision === s ? "bg-[#A100FF] text-white" : "bg-[#F2F2F2] text-[#6A6A6A] hover:bg-[#E0E0E0]"}`}>
                  {s === "" ? "Tous" : USER_STATUS_CFG[s]?.label}
                </button>
              ))}
              <div className="flex-1"/>
              <span className="text-xs text-[#6A6A6A]">{filtered.length}/{result.items.length} lignes</span>
            </div>

            {/* Compteurs décisions */}
            <div className="flex items-center gap-2 px-4 py-1.5 bg-[#FAFAFA] border-b border-[#E0E0E0] flex-wrap">
              {([
                { key: "genere",        label: "Généré",       color: "#6B7280", bg: "#F3F4F6", border: "#D1D5DB" },
                { key: "a_arbitrer_mh", label: "Arbitrage MH", color: "#D97706", bg: "#FFF7ED", border: "#FED7AA" },
                { key: "valide_metier", label: "Validé",       color: "#16A34A", bg: "#F0FDF4", border: "#BBF7D0" },
                { key: "voir_kapia",    label: "Voir KAPIA",   color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE" },
              ] as { key: string; label: string; color: string; bg: string; border: string }[]).map(({ key, label, color, bg, border }) => (
                <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border"
                  style={{ backgroundColor: bg, color, borderColor: border }}>
                  <span className="font-semibold">{decisionCounts[key] ?? 0}</span>
                  <span>{label}</span>
                </span>
              ))}
            </div>

            {/* Tableau */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#FAFAFA] text-[#6A6A6A] border-b border-[#E0E0E0]">
                    <th className="w-8 px-2 py-2">
                      <input type="checkbox" className="accent-[#A100FF]"
                        checked={allFilteredIndexes.length > 0 && allFilteredIndexes.every(i => selectedRows.has(i))}
                        onChange={e => {
                          const next = new Set(selectedRows);
                          allFilteredIndexes.forEach(i => e.target.checked ? next.add(i) : next.delete(i));
                          setSelectedRows(next);
                        }}/>
                    </th>
                    <th className="w-8 px-2 py-2"></th>
                    <th className="text-left px-3 py-2 w-44">Paramètre V1</th>
                    <th className="text-left px-3 py-2 w-24">Valeur V1</th>
                    <th className="text-left px-3 py-2 w-44">Paramètre V2</th>
                    <th className="text-left px-3 py-2 w-24">Valeur V2</th>
                    <th className="text-left px-3 py-2 w-24">Statut IA</th>
                    <th className="text-left px-3 py-2">Décision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2F2F2]">
                  {filtered.map((item) => {
                    const origIndex = result.items.indexOf(item);
                    const sk = (item.status as SKey) in STATUS_CFG ? item.status as SKey : "conforme";
                    const ann = annotations[String(origIndex)] ?? { user_status: "genere", user_comment: "" };
                    const isV2Only = item.status === "nouveau";
                    const isV1Only = item.status === "supprime";
                    const rowKey = String(origIndex);
                    const isExpanded = expandedRows.has(rowKey);
                    return (
                      <>
                        <tr key={origIndex} className={`hover:bg-[#F9F6FF]/40 ${STATUS_CFG[sk].bg.replace("-50", "-50/30")}`}>
                          <td className="px-2 py-2 text-center">
                            <input type="checkbox" className="accent-[#A100FF]"
                              checked={selectedRows.has(origIndex)}
                              onChange={e => {
                                const next = new Set(selectedRows);
                                e.target.checked ? next.add(origIndex) : next.delete(origIndex);
                                setSelectedRows(next);
                              }}/>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button onClick={() => toggleRow(rowKey)} className="text-[#6A6A6A] hover:text-[#A100FF]">
                              {isExpanded ? <EyeOff className="w-3.5 h-3.5"/> : <Eye className="w-3.5 h-3.5"/>}
                            </button>
                          </td>
                          <td className="px-3 py-2 font-medium text-black">
                            {isV2Only ? <span className="italic text-[#9ca3af]">—</span> : item.parametre}
                          </td>
                          <td className={`px-3 py-2 font-semibold ${item.status === "ecart" ? "line-through text-[#9ca3af]" : "text-[#3D3D3D]"}`}>
                            {item.valeur_v1 ?? <span className="italic text-[#9ca3af] font-normal">—</span>}
                          </td>
                          <td className="px-3 py-2 text-[#6A6A6A]">
                            {isV1Only ? <span className="italic text-[#9ca3af]">—</span> : item.parametre}
                          </td>
                          <td className={`px-3 py-2 font-semibold ${item.status === "ecart" ? "text-red-700" : "text-[#3D3D3D]"}`}>
                            {item.valeur_v2 ?? <span className="italic text-[#9ca3af] font-normal">—</span>}
                          </td>
                          <td className="px-3 py-2"><IAStatusBadge status={sk}/></td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1 flex-wrap">
                              {STATUS_BTNS.map(s => {
                                const isActive = (ann.user_status || "genere") === s.key;
                                const cfg = USER_STATUS_CFG[s.key];
                                return (
                                  <button key={s.key}
                                    onClick={() => updateAnnotation(origIndex, { user_status: s.key })}
                                    className={`text-[10px] px-1.5 py-0.5 rounded-full transition-all whitespace-nowrap ${isActive ? cfg.activeCls : cfg.inactiveCls}`}>
                                    {s.label}
                                  </button>
                                );
                              })}
                              {ann.user_comment && (
                                <span className="text-[#6A6A6A]" title={ann.user_comment}>
                                  <MessageSquare className="w-3 h-3"/>
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`x-${origIndex}`}>
                            <td colSpan={8} className="bg-[#FAFAFA] px-6 py-3">
                              <div className="flex flex-col gap-3">
                                {item.explication && (
                                  <div className="flex gap-1.5 items-start pl-2 border-l-2 border-[#A100FF]/40 text-[11px] text-[#3D3D3D]">
                                    <Sparkles className="w-3 h-3 text-[#A100FF] mt-0.5 shrink-0"/>
                                    <span>{item.explication}</span>
                                  </div>
                                )}
                                {item.impact_metier && (
                                  <div className="text-[11px] text-orange-700 bg-orange-50 border border-orange-100 px-3 py-1.5">
                                    Impact métier : {item.impact_metier}
                                  </div>
                                )}
                                <div className="flex items-start gap-2">
                                  <MessageSquare className="w-3.5 h-3.5 text-[#6A6A6A] mt-1 shrink-0"/>
                                  <textarea
                                    value={ann.user_comment || ""}
                                    onChange={e => updateAnnotation(origIndex, { user_comment: e.target.value })}
                                    placeholder="Commentaire métier…"
                                    rows={2}
                                    className="flex-1 text-xs border border-[#E0E0E0] px-2 py-1.5 resize-none focus:outline-none focus:border-[#A100FF] bg-white text-[#3D3D3D]"
                                  />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-sm text-[#6A6A6A] py-8">Aucun résultat.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Barre flottante bulk */}
      {selectedRows.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-white border border-[#A100FF] shadow-xl px-5 py-3 rounded-full">
          <span className="text-sm font-semibold text-[#3D3D3D] pr-2 border-r border-[#E0E0E0]">
            {selectedRows.size} ligne{selectedRows.size > 1 ? "s" : ""}
          </span>
          {(([
            { status: "valide_metier", label: "Validé",       cls: "bg-[#16A34A] text-white hover:bg-[#15803D]" },
            { status: "a_arbitrer_mh", label: "Arbitrage MH", cls: "bg-[#D97706] text-white hover:bg-[#B45309]" },
            { status: "voir_kapia",    label: "Voir KAPIA",   cls: "bg-[#2563EB] text-white hover:bg-[#1D4ED8]" },
            { status: "genere",        label: "Généré",       cls: "bg-[#6B7280] text-white hover:bg-[#374151]" },
          ]) as { status: string; label: string; cls: string }[]).map(({ status, label, cls }) => (
            <button key={status}
              onClick={() => {
                const ids = Array.from(selectedRows);
                setAnnotations(prev => {
                  const next = { ...prev };
                  ids.forEach(i => { next[String(i)] = { ...(next[String(i)] ?? { user_comment: "" }), user_status: status }; });
                  saveAnnotations(next);
                  return next;
                });
                setSelectedRows(new Set());
              }}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-all ${cls}`}>
              {label}
            </button>
          ))}
          <button onClick={() => setSelectedRows(new Set())} className="text-[#9A9A9A] hover:text-black p-1 ml-1">
            <X className="w-4 h-4"/>
          </button>
        </div>
      )}
    </div>
  );
}
