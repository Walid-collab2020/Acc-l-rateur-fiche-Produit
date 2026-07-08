"use client";
import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CheckCircle, AlertTriangle, XCircle, ChevronDown, ChevronRight,
  Upload, FileText, Wand2, Eye, EyeOff, Loader2, Sparkles, History,
  Filter, X, MessageSquare,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  productsApi, recetteApi, reportingApi,
  type Product, type RecetteFppVersion, type CompareResult, type CompareItem,
  type ProductStats, type RecetteHistoryEntry, type RecetteAnnotation,
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

const COMPARE_CFG = {
  conforme:     { bg:"bg-green-50",  text:"text-green-700",  border:"border-green-200",  fill:"#22c55e", label:"Conforme" },
  non_conforme: { bg:"bg-red-50",    text:"text-red-700",    border:"border-red-200",    fill:"#ef4444", label:"Non conforme" },
  non_retrouve: { bg:"bg-orange-50", text:"text-orange-700", border:"border-orange-200", fill:"#f97316", label:"Non retrouvé" },
  incertain:    { bg:"bg-purple-50", text:"text-purple-700", border:"border-purple-200", fill:"#a855f7", label:"Incertain" },
} as const;
type CKey = keyof typeof COMPARE_CFG;

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
    return (
      <div className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5">
        <CheckCircle className="w-3.5 h-3.5" /> Validé
      </div>
    );
  }
  return (
    <button onClick={() => mut.mutate()} disabled={mut.isPending}
      className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-50">
      {mut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <CheckCircle className="w-3.5 h-3.5"/>}
      Valider la recette
    </button>
  );
}

function IAStatusBadge({ status }: { status: CKey }) {
  const c = COMPARE_CFG[status] ?? COMPARE_CFG.incertain;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium border ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
    </span>
  );
}

function UserStatusBadge({ status }: { status?: string | null }) {
  const cfg = USER_STATUS_CFG[status || "genere"] ?? USER_STATUS_CFG.genere;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium border ${cfg.badgeCls}`}>
      {cfg.label}
    </span>
  );
}

function FileUpload({ label, accept, file, onChange }: {
  label: string; accept: string; file: File | null; onChange: (f: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div onClick={() => ref.current?.click()}
      className={`flex items-center gap-3 border-2 border-dashed px-4 py-3 cursor-pointer min-h-[48px] transition-colors ${
        file ? "border-[#A100FF] bg-[#F9F6FF]" : "border-[#E0E0E0] hover:border-[#A100FF]/50"
      }`}>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => onChange(e.target.files?.[0] ?? null)} />
      {file
        ? <><FileText className="w-4 h-4 text-[#A100FF] shrink-0"/><span className="text-xs text-[#A100FF] font-medium truncate">{file.name}</span></>
        : <><Upload className="w-4 h-4 text-[#6A6A6A] shrink-0"/><span className="text-xs text-[#6A6A6A]">{label}</span></>
      }
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function RecettePage() {
  const [productId, setProductId]         = useState<number | null>(null);
  const [fppVersion, setFppVersion]       = useState<number | null>(null);
  const [fileKELIA, setFileKELIA]         = useState<File | null>(null);
  const [provider, setProvider]           = useState("openai-gpt5");
  const [compareResult, setResult]        = useState<CompareResult | null>(null);
  const [filterStatus, setFilter]         = useState<string>("");
  const [filterDecision, setFilterDecision] = useState<string>("");
  const [expandedRows, setExpandedRows]   = useState<Set<number>>(new Set());
  const [showHistory, setShowHistory]     = useState(false);
  const [selectedRows, setSelectedRows]   = useState<Set<number>>(new Set());
  const [annotations, setAnnotations]     = useState<Record<string, RecetteAnnotation>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => productsApi.list().then(r => r.data),
  });
  const { data: fppVersions = [] } = useQuery<RecetteFppVersion[]>({
    queryKey: ["recette-versions", productId],
    queryFn: () => recetteApi.versions(productId!).then(r => r.data),
    enabled: !!productId,
  });
  const { data: historyList = [], refetch: refetchHistory } = useQuery<RecetteHistoryEntry[]>({
    queryKey: ["recette-history", productId],
    queryFn: () => recetteApi.historyList(productId!).then(r => r.data),
    enabled: !!productId,
  });

  const mutation = useMutation({
    mutationFn: () => recetteApi.compare(productId!, fppVersion!, fileKELIA!, provider).then(r => r.data),
    onSuccess: (data) => {
      setResult(data);
      setAnnotations(data.annotations ?? {});
      setExpandedRows(new Set());
      setFilter("");
      setFilterDecision("");
      setSelectedRows(new Set());
      refetchHistory();
    },
  });

  const saveAnnotations = useCallback((updated: Record<string, RecetteAnnotation>, historyId?: number) => {
    const id = historyId ?? compareResult?.history_id;
    if (!id) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      recetteApi.updateAnnotations(id, updated);
    }, 600);
  }, [compareResult?.history_id]);

  const updateAnnotation = (index: number, patch: Partial<RecetteAnnotation>) => {
    setAnnotations(prev => {
      const cur = prev[String(index)] ?? { user_status: "genere", user_comment: "" };
      const next = { ...prev, [String(index)]: { ...cur, ...patch } };
      saveAnnotations(next);
      return next;
    });
  };

  async function loadHistory(id: number) {
    const r = await recetteApi.historyDetail(id);
    setResult(r.data as CompareResult);
    setAnnotations((r.data as CompareResult).annotations ?? {});
    setExpandedRows(new Set());
    setFilter("");
    setFilterDecision("");
    setSelectedRows(new Set());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const canRun = !!productId && !!fppVersion && !!fileKELIA;

  const filteredItems = useMemo(() => {
    if (!compareResult) return [];
    return compareResult.items.filter((item, i) => {
      if (filterStatus && item.status !== filterStatus) return false;
      if (filterDecision) {
        const ann = annotations[String(i)];
        const us = ann?.user_status || "genere";
        if (us !== filterDecision) return false;
      }
      return true;
    });
  }, [compareResult, filterStatus, filterDecision, annotations]);

  const isMultiProduct = useMemo(
    () => !!compareResult && compareResult.items.some(i => i.produit_kelia !== ""),
    [compareResult]
  );

  const decisionCounts = useMemo(() => {
    if (!compareResult) return {} as Record<string, number>;
    const counts: Record<string, number> = { genere: 0, a_arbitrer_mh: 0, valide_metier: 0, voir_kapia: 0 };
    compareResult.items.forEach((_, i) => {
      const us = annotations[String(i)]?.user_status || "genere";
      if (us in counts) counts[us]++;
      else counts.genere++;
    });
    return counts;
  }, [compareResult, annotations]);

  function toggleRow(index: number) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  function renderStatutBanner(statut: string) {
    if (statut === "Conforme") return (
      <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 text-sm text-green-800 font-medium">
        <CheckCircle className="w-4 h-4 text-green-600 shrink-0"/>Recette conforme — aucune anomalie détectée.
      </div>
    );
    if (statut === "Conforme avec réserves") return (
      <div className="flex items-center gap-2 px-4 py-3 bg-yellow-50 border border-yellow-200 text-sm text-yellow-800 font-medium">
        <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0"/>Conforme avec réserves — anomalies mineures à examiner.
      </div>
    );
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 text-sm text-red-800 font-medium">
        <XCircle className="w-4 h-4 text-red-600 shrink-0"/>Non conforme — anomalies bloquantes détectées.
      </div>
    );
  }

  const allFilteredIndexes = useMemo(() => {
    if (!compareResult) return [];
    return compareResult.items.reduce<number[]>((acc, item, i) => {
      if (filterStatus && item.status !== filterStatus) return acc;
      if (filterDecision) {
        const us = annotations[String(i)]?.user_status || "genere";
        if (us !== filterDecision) return acc;
      }
      acc.push(i);
      return acc;
    }, []);
  }, [compareResult, filterStatus, filterDecision, annotations]);

  return (
    <div className="p-6 space-y-5">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-black">Recette Paramétrage</h1>
          <p className="text-xs text-[#6A6A6A] mt-0.5">Vérifiez que le paramétrage KELIA est conforme à la Fiche Produit Paramétrée.</p>
        </div>
        {productId && historyList.length > 0 && (
          <button onClick={() => setShowHistory(v => !v)}
            className="flex items-center gap-1.5 text-xs text-[#A100FF] border border-[#A100FF]/30 px-3 py-1.5 hover:bg-[#F9F6FF]">
            <History className="w-3.5 h-3.5"/>Historique ({historyList.length})
          </button>
        )}
      </div>

      {/* Config */}
      <div className="card space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#6A6A6A] mb-1.5">Produit</label>
            <select value={productId ?? ""} onChange={e => {
              setProductId(e.target.value ? Number(e.target.value) : null);
              setFppVersion(null); setResult(null);
            }} className="border border-[#E0E0E0] px-3 py-2 text-sm w-full focus:outline-none focus:border-[#A100FF]">
              <option value="">-- Sélectionner --</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.boss_number}{p.name ? ` — ${p.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#6A6A6A] mb-1.5">Version FPP de référence</label>
            <select value={fppVersion ?? ""} onChange={e => setFppVersion(e.target.value ? Number(e.target.value) : null)}
              disabled={!productId || !fppVersions.length}
              className="border border-[#E0E0E0] px-3 py-2 text-sm w-full focus:outline-none focus:border-[#A100FF] disabled:bg-[#F2F2F2]">
              <option value="">-- Sélectionner --</option>
              {fppVersions.map(v => (
                <option key={v.version} value={v.version}>
                  {v.label} — {v.filled_count}/{v.item_count}{v.created_at ? ` (${new Date(v.created_at).toLocaleDateString("fr-FR")})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#6A6A6A] mb-1.5">Modèle LLM</label>
            <select value={provider} onChange={e => setProvider(e.target.value)}
              className="border border-[#E0E0E0] px-3 py-2 text-sm w-full focus:outline-none focus:border-[#A100FF]">
              {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-xs font-medium text-[#6A6A6A] mb-1.5">
              Fichier paramétrage KELIA <span className="font-normal">(Excel ou CSV)</span>
            </label>
            <FileUpload label="Déposer le fichier paramétrage KELIA…" accept=".xlsx,.xls,.xlsm,.csv"
              file={fileKELIA} onChange={setFileKELIA}/>
          </div>
          <button onClick={() => mutation.mutate()} disabled={!canRun || mutation.isPending}
            className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50 h-[48px] px-5 shrink-0">
            {mutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin"/>Analyse en cours…</>
              : <><Wand2 className="w-4 h-4"/>Générer la matrice</>}
          </button>
        </div>
        {mutation.isError && (
          <p className="text-xs text-red-600">{String((mutation.error as Error)?.message)}</p>
        )}
      </div>

      {/* Historique */}
      {showHistory && productId && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-black">Historique des recettes</h3>
            <button onClick={() => setShowHistory(false)} className="text-[10px] text-[#6A6A6A] hover:text-black">✕</button>
          </div>
          <div className="overflow-hidden border border-[#E0E0E0]">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#FAFAFA] text-[#6A6A6A] border-b border-[#E0E0E0]">
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Fichier KELIA</th>
                  <th className="text-left px-3 py-2 w-20">FPP</th>
                  <th className="text-left px-3 py-2 w-16">Lignes</th>
                  <th className="text-left px-3 py-2 w-16">Taux</th>
                  <th className="text-left px-3 py-2 w-28">Statut</th>
                  <th className="w-20 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F2F2]">
                {historyList.map(h => (
                  <tr key={h.id} className="hover:bg-[#F9F6FF]">
                    <td className="px-3 py-1.5 text-[#6A6A6A]">
                      {h.created_at ? new Date(h.created_at).toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit" }) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-[#3D3D3D] max-w-[200px] truncate">{h.filename_kelia || "—"}</td>
                    <td className="px-3 py-1.5 text-[#6A6A6A]">V{h.fpp_version}</td>
                    <td className="px-3 py-1.5 text-[#6A6A6A]">{h.kelia_rows}</td>
                    <td className="px-3 py-1.5 font-semibold text-[#A100FF]">{h.taux_conformite}%</td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 ${
                        h.statut_global === "Conforme" ? "bg-green-100 text-green-700" :
                        h.statut_global === "Conforme avec réserves" ? "bg-yellow-100 text-yellow-700" :
                        "bg-red-100 text-red-700"
                      }`}>{h.statut_global}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button onClick={() => loadHistory(h.id)}
                        className="text-[10px] text-[#A100FF] hover:underline font-medium">Charger</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Résultats */}
      {compareResult && (
        <div className="space-y-4">
          {/* Bannière + valider */}
          <div className="flex items-center gap-3">
            <div className="flex-1">{renderStatutBanner(compareResult.statut_global)}</div>
            {productId && <ValidateButton productId={productId} module="recette" />}
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-5 gap-3">
            <div className="bg-white border border-[#E0E0E0] p-3 text-center">
              <div className="text-2xl font-bold text-[#3D3D3D]">{compareResult.kelia_rows}</div>
              <div className="text-xs text-[#6A6A6A] mt-0.5">Total analysés</div>
            </div>
            {(Object.keys(COMPARE_CFG) as CKey[]).map(k => (
              <div key={k} className={`border p-3 text-center ${COMPARE_CFG[k].bg} ${COMPARE_CFG[k].border}`}>
                <div className={`text-2xl font-bold ${COMPARE_CFG[k].text}`}>{compareResult.summary[k]}</div>
                <div className={`text-xs mt-0.5 ${COMPARE_CFG[k].text}`}>{COMPARE_CFG[k].label}</div>
              </div>
            ))}
          </div>

          {/* Pie chart + décisions */}
          <div className="grid grid-cols-2 gap-4">
            <div className="card">
              <div className="text-xs font-semibold text-[#6A6A6A] mb-3">Répartition IA</div>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={(Object.keys(COMPARE_CFG) as CKey[]).filter(k => compareResult.summary[k] > 0).map(k => ({ name: COMPARE_CFG[k].label, value: compareResult.summary[k], fill: COMPARE_CFG[k].fill }))}
                      cx="50%" cy="50%" innerRadius={28} outerRadius={52} dataKey="value" paddingAngle={2}>
                      {(Object.keys(COMPARE_CFG) as CKey[]).filter(k => compareResult.summary[k] > 0).map((k, i) => <Cell key={i} fill={COMPARE_CFG[k].fill}/>)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, n]}/>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5">
                  {(Object.keys(COMPARE_CFG) as CKey[]).map(k => (
                    <div key={k} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COMPARE_CFG[k].fill }}/>
                      <span className="text-[#3D3D3D]">{COMPARE_CFG[k].label}</span>
                      <span className="font-semibold ml-auto pl-2">{compareResult.summary[k]}</span>
                    </div>
                  ))}
                  <div className="border-t border-[#E0E0E0] pt-1.5 mt-1 text-xs">
                    <span className="text-[#A100FF] font-bold text-base">{compareResult.taux_conformite}%</span>
                    <span className="text-[#6A6A6A] ml-1">conformité</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="text-xs font-semibold text-[#6A6A6A] mb-3">Décisions métier</div>
              <div className="grid grid-cols-2 gap-2">
                {STATUS_BTNS.map(({ key, label }) => {
                  const cfg = USER_STATUS_CFG[key];
                  const count = decisionCounts[key] ?? 0;
                  return (
                    <div key={key} className={`flex items-center justify-between px-3 py-2 border text-xs ${cfg.badgeCls}`}>
                      <span>{label}</span>
                      <span className="font-bold text-sm">{count}</span>
                    </div>
                  );
                })}
              </div>
              <div className="text-[10px] text-[#9CA3AF] mt-2">Total : {compareResult.items.length} lignes</div>
            </div>
          </div>

          {/* Filtres IA + décision */}
          <div className="card p-0">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-[#E0E0E0] bg-[#FAFAFA] flex-wrap">
              <Filter className="w-3.5 h-3.5 text-[#6A6A6A] shrink-0"/>
              <span className="text-xs text-[#6A6A6A] shrink-0">Statut IA :</span>
              {["", ...Object.keys(COMPARE_CFG)].map(s => (
                <button key={s} onClick={() => setFilter(s)}
                  className={`text-xs px-2 py-0.5 transition-colors shrink-0 ${filterStatus === s ? "bg-[#A100FF] text-white" : "bg-[#F2F2F2] text-[#6A6A6A] hover:bg-[#E0E0E0]"}`}>
                  {s === "" ? "Tous" : COMPARE_CFG[s as CKey]?.label}
                  {s !== "" && ` (${compareResult.summary[s as CKey] ?? 0})`}
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
              <span className="text-xs text-[#6A6A6A]">{filteredItems.length}/{compareResult.items.length} lignes</span>
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
                    {isMultiProduct && <th className="text-left px-3 py-2 w-28">Produit</th>}
                    <th className="text-left px-3 py-2 w-44">Paramètre KELIA</th>
                    <th className="text-left px-3 py-2 w-24">Valeur KELIA</th>
                    <th className="text-left px-3 py-2 w-44">Paramètre FPP</th>
                    <th className="text-left px-3 py-2 w-24">Valeur FPP</th>
                    <th className="text-left px-3 py-2 w-24">Statut IA</th>
                    <th className="text-left px-3 py-2">Décision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2F2F2]">
                  {filteredItems.map((item) => {
                    const origIndex = compareResult.items.indexOf(item);
                    const ann = annotations[String(origIndex)] ?? { user_status: "genere", user_comment: "" };
                    const isExpanded = expandedRows.has(origIndex);
                    return (
                      <>
                        <tr key={origIndex}
                          className={`hover:bg-[#F9F6FF]/40 ${
                            item.status === "non_conforme" ? "bg-red-50/60" :
                            item.status === "non_retrouve" ? "bg-orange-50/60" :
                            item.status === "incertain"    ? "bg-purple-50/40" : ""
                          }`}>
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
                            <button onClick={() => toggleRow(origIndex)}
                              className="text-[#6A6A6A] hover:text-[#A100FF] transition-colors"
                              title={isExpanded ? "Masquer" : "Détail"}>
                              {isExpanded ? <EyeOff className="w-3.5 h-3.5"/> : <Eye className="w-3.5 h-3.5"/>}
                            </button>
                          </td>
                          {isMultiProduct && <td className="px-3 py-2 text-[#6A6A6A]">{item.produit_kelia || "—"}</td>}
                          <td className="px-3 py-2 font-medium text-black">{item.parametre_kelia ?? "—"}</td>
                          <td className={`px-3 py-2 font-semibold ${item.status === "non_conforme" ? "text-orange-700" : "text-[#3D3D3D]"}`}>
                            {item.valeur_kelia ?? <span className="italic text-[#9ca3af] font-normal">—</span>}
                          </td>
                          <td className="px-3 py-2 text-[#6A6A6A] italic">{item.parametre_fpp ?? "—"}</td>
                          <td className={`px-3 py-2 font-semibold ${item.status === "non_conforme" ? "text-red-700" : "text-[#3D3D3D]"}`}>
                            {item.valeur_fpp ?? <span className="italic text-[#9ca3af] font-normal">—</span>}
                          </td>
                          <td className="px-3 py-2"><IAStatusBadge status={item.status as CKey}/></td>
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
                          <tr key={`exp-${origIndex}`}>
                            <td colSpan={isMultiProduct ? 10 : 9} className="bg-[#FAFAFA] px-6 py-3">
                              <div className="flex flex-col gap-3">
                                {item.explication && (
                                  <div className="flex gap-1.5 items-start pl-2 border-l-2 border-[#A100FF]/40 text-[11px] text-[#3D3D3D]">
                                    <Sparkles className="w-3 h-3 text-[#A100FF] mt-0.5 shrink-0"/>
                                    <span>{item.explication}</span>
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
                  {filteredItems.length === 0 && (
                    <tr><td colSpan={isMultiProduct ? 10 : 9} className="text-center text-sm text-[#6A6A6A] py-8">Aucun résultat.</td></tr>
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
