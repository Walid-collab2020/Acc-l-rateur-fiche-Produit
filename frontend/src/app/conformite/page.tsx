"use client";
import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Upload, FileText, ShieldCheck, Loader2, CheckCircle,
  AlertTriangle, History, ChevronRight, ChevronLeft, Sparkles,
} from "lucide-react";
import {
  conformiteApi, productsApi, recetteApi, reportingApi,
  type ConformiteResult, type ConformiteEngagement, type ConformiteArticle,
  type ConformiteHistoryEntry, type Product, type RecetteFppVersion,
} from "@/lib/api";

// ── Statuts ───────────────────────────────────────────────────────────────────
const STATUT_CFG = {
  conforme:           { label: "Correctement paramétré", bg: "bg-green-50",   text: "text-green-700",  border: "border-green-200",  fill: "#22c55e" },
  partiel:            { label: "Partiellement couvert",  bg: "bg-yellow-50",  text: "text-yellow-700", border: "border-yellow-200", fill: "#eab308" },
  non_repris:         { label: "Non repris dans la FPP", bg: "bg-red-50",     text: "text-red-700",    border: "border-red-200",    fill: "#ef4444" },
  validation_requise: { label: "Validation métier",      bg: "bg-purple-50",  text: "text-purple-700", border: "border-purple-200", fill: "#a855f7" },
  sans_impact:        { label: "Sans impact paramétrage",bg: "bg-gray-50",    text: "text-gray-500",   border: "border-gray-200",   fill: "#9ca3af" },
} as const;
type SKey = keyof typeof STATUT_CFG;

const RISQUE_CFG: Record<string, { label: string; color: string }> = {
  juridique:     { label: "Juridique",      color: "bg-red-100 text-red-700 border-red-200" },
  actuariel:     { label: "Actuariel",      color: "bg-orange-100 text-orange-700 border-orange-200" },
  financier:     { label: "Financier",      color: "bg-amber-100 text-amber-700 border-amber-200" },
  operationnel:  { label: "Opérationnel",   color: "bg-blue-100 text-blue-700 border-blue-200" },
  reglementaire: { label: "Réglementaire",  color: "bg-purple-100 text-purple-700 border-purple-200" },
};

const NIVEAU_CFG: Record<string, string> = {
  critique: "bg-red-600 text-white",
  eleve:    "bg-orange-500 text-white",
  moyen:    "bg-amber-400 text-black",
  faible:   "bg-green-200 text-green-800",
};

const MODEL_OPTIONS = [
  { value: "openai-gpt5", label: "GPT-5" },
  { value: "anthropic",   label: "Claude Sonnet 4.6" },
  { value: "openai",      label: "GPT-4o" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function worstStatus(article: ConformiteArticle): SKey {
  const order: SKey[] = ["non_repris", "validation_requise", "partiel", "conforme", "sans_impact"];
  for (const s of order) {
    if (article.engagements.some(e => e.statut === s)) return s;
  }
  return "sans_impact";
}

function StatutBadge({ statut }: { statut: SKey }) {
  const c = STATUT_CFG[statut] ?? STATUT_CFG.sans_impact;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded border ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
    </span>
  );
}

function RisqueBadge({ type, niveau }: { type: string | null; niveau: string }) {
  if (!type || type === "null") return null;
  const rt = RISQUE_CFG[type];
  const nv = NIVEAU_CFG[niveau] ?? NIVEAU_CFG.faible;
  return (
    <div className="flex items-center gap-1">
      {rt && <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border ${rt.color}`}>{rt.label}</span>}
      <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded ${nv}`}>{niveau}</span>
    </div>
  );
}

function FileUpload({ label, accept, file, onChange }: {
  label: string; accept: string; file: File | null; onChange: (f: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => ref.current?.click()}
      className={`flex items-center gap-3 border-2 border-dashed px-4 py-3.5 cursor-pointer transition-colors ${
        file ? "border-[#A100FF] bg-[#F9F6FF]" : "border-[#E0E0E0] hover:border-[#A100FF]/50"
      }`}
    >
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => onChange(e.target.files?.[0] ?? null)} />
      {file ? (
        <>
          <FileText className="w-4 h-4 text-[#A100FF] shrink-0" />
          <div>
            <div className="text-xs text-[#A100FF] font-medium truncate max-w-[260px]">{file.name}</div>
            <div className="text-[10px] text-[#6A6A6A]">{(file.size / 1024).toFixed(0)} Ko</div>
          </div>
        </>
      ) : (
        <>
          <Upload className="w-4 h-4 text-[#6A6A6A] shrink-0" />
          <div className="text-xs text-[#6A6A6A] font-medium">{label}</div>
        </>
      )}
    </div>
  );
}

function ValidateButton({ productId }: { productId: number }) {
  const [validated, setValidated] = useState(false);
  const mut = useMutation({
    mutationFn: () => reportingApi.validateModule(productId, "recette"),
    onSuccess: () => setValidated(true),
  });
  if (validated) return (
    <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded">
      <CheckCircle className="w-3.5 h-3.5" /> Validé
    </span>
  );
  return (
    <button onClick={() => mut.mutate()} disabled={mut.isPending}
      className="text-xs font-medium text-white bg-[#A100FF] px-4 py-1.5 hover:bg-[#8800dd] disabled:opacity-50 rounded flex items-center gap-1.5">
      <CheckCircle className="w-3.5 h-3.5" />{mut.isPending ? "…" : "Valider"}
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ConformitePage() {
  const [productId, setProductId]   = useState<number | null>(null);
  const [fppVersion, setFppVersion] = useState<number | null>(null);
  const [fileCG, setFileCG]         = useState<File | null>(null);
  const [provider, setProvider]     = useState("openai-gpt5");
  const [result, setResult]         = useState<ConformiteResult | null>(null);
  const [viewMode, setViewMode]     = useState<"table" | "articles">("articles");
  const [filterStatut, setFilterStatut] = useState("");
  const [filterRisque, setFilterRisque] = useState("");
  const [filterNiveau, setFilterNiveau] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => productsApi.list().then(r => r.data),
  });

  const { data: fppVersions = [] } = useQuery<RecetteFppVersion[]>({
    queryKey: ["recette-versions", productId],
    queryFn: () => recetteApi.versions(productId!).then(r => r.data),
    enabled: !!productId,
  });

  const { data: historyList = [], refetch: refetchHistory } = useQuery<ConformiteHistoryEntry[]>({
    queryKey: ["conformite-history", productId],
    queryFn: () => conformiteApi.historyList(productId!).then(r => r.data),
    enabled: !!productId,
  });

  const mutation = useMutation({
    mutationFn: () => conformiteApi.analyze(fileCG!, provider, productId!, fppVersion!).then(r => r.data),
    onSuccess: (data) => {
      setResult(data);
      setFilterStatut(""); setFilterRisque(""); setFilterNiveau("");
      setSelectedArticle(data.articles?.[0]?.article ?? null);
      refetchHistory();
    },
  });

  const canRun = !!productId && !!fppVersion && !!fileCG;

  async function loadHistory(id: number) {
    const r = await conformiteApi.historyDetail(id);
    setResult(r.data as ConformiteResult);
    setFilterStatut(""); setFilterRisque(""); setFilterNiveau("");
    setSelectedArticle(r.data.articles?.[0]?.article ?? null);
    setShowHistory(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Tous les engagements aplatis avec leur article
  const allEngagements = useMemo(() => {
    if (!result) return [];
    return result.articles.flatMap(art =>
      art.engagements.map(e => ({ ...e, article: art.article }))
    );
  }, [result]);

  const filtered = useMemo(() => {
    return allEngagements.filter(e => {
      if (filterStatut && e.statut !== filterStatut) return false;
      if (filterRisque && e.risque_type !== filterRisque) return false;
      if (filterNiveau && e.risque_niveau !== filterNiveau) return false;
      return true;
    });
  }, [allEngagements, filterStatut, filterRisque, filterNiveau]);

  const filteredArticles = useMemo(() => {
    if (!result) return [];
    if (!filterStatut && !filterRisque && !filterNiveau) return result.articles;
    return result.articles.map(art => ({
      ...art,
      engagements: art.engagements.filter(e => {
        if (filterStatut && e.statut !== filterStatut) return false;
        if (filterRisque && e.risque_type !== filterRisque) return false;
        if (filterNiveau && e.risque_niveau !== filterNiveau) return false;
        return true;
      }),
    })).filter(art => art.engagements.length > 0);
  }, [result, filterStatut, filterRisque, filterNiveau]);

  const currentArticleIdx = filteredArticles.findIndex(a => a.article === selectedArticle);
  const currentArticle = filteredArticles[currentArticleIdx] ?? filteredArticles[0] ?? null;

  return (
    <div className="p-6 space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-black">Analyse de conformité contractuelle</h1>
          <p className="text-xs text-[#6A6A6A] mt-0.5">
            Vérifiez que le paramétrage KELIA respecte les exigences des Conditions Générales.
          </p>
        </div>
        {productId && historyList.length > 0 && (
          <button onClick={() => setShowHistory(v => !v)}
            className="flex items-center gap-1.5 text-xs text-[#A100FF] border border-[#A100FF]/30 px-3 py-1.5 hover:bg-[#F9F6FF]">
            <History className="w-3.5 h-3.5"/>
            Historique ({historyList.length})
          </button>
        )}
      </div>

      {/* ── Historique ── */}
      {showHistory && productId && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-black">Historique des analyses</h3>
            <button onClick={() => setShowHistory(false)} className="text-[10px] text-[#6A6A6A] hover:text-black">✕</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#F9F6FF] text-[#6A6A6A] border-b border-[#E0E0E0]">
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">FPP</th>
                  <th className="text-left px-3 py-2">Conditions Générales</th>
                  <th className="text-left px-3 py-2">Score</th>
                  <th className="text-right px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F2F2]">
                {historyList.map(h => (
                  <tr key={h.id} className="hover:bg-[#F9F6FF]">
                    <td className="px-3 py-1.5 text-[#6A6A6A]">
                      {h.created_at ? new Date(h.created_at).toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit" }) : "—"}
                    </td>
                    <td className="px-3 py-1.5 font-medium text-[#A100FF]">{h.filename_kelia}</td>
                    <td className="px-3 py-1.5 max-w-[200px] truncate">{h.filename_contract}</td>
                    <td className="px-3 py-1.5 font-semibold text-[#A100FF]">{h.score_conformite}%</td>
                    <td className="px-3 py-1.5 text-right flex items-center gap-2 justify-end">
                      <button onClick={() => loadHistory(h.id)}
                        className="text-[10px] text-[#A100FF] hover:underline font-medium">Charger</button>
                      <a href={`${API_URL}/conformite/history/${h.id}/export`}
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

      {/* ── Config ── */}
      <div className="card space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {/* Produit */}
          <div>
            <label className="block text-xs font-medium text-[#6A6A6A] mb-1.5">Produit</label>
            <select value={productId ?? ""} onChange={e => {
              setProductId(e.target.value ? Number(e.target.value) : null);
              setFppVersion(null); setResult(null);
            }} className="border border-[#E0E0E0] px-3 py-2 text-sm w-full focus:outline-none focus:border-[#A100FF]">
              <option value="">— Sélectionner —</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.boss_number}{p.name ? ` — ${p.name}` : ""}</option>)}
            </select>
          </div>
          {/* Version FPP */}
          <div>
            <label className="block text-xs font-medium text-[#6A6A6A] mb-1.5">Version FPP de référence</label>
            <select value={fppVersion ?? ""} onChange={e => setFppVersion(e.target.value ? Number(e.target.value) : null)}
              disabled={!productId || !fppVersions.length}
              className="border border-[#E0E0E0] px-3 py-2 text-sm w-full focus:outline-none focus:border-[#A100FF] disabled:bg-[#F2F2F2]">
              <option value="">— Sélectionner —</option>
              {fppVersions.map(v => (
                <option key={v.version} value={v.version}>
                  {v.label} — {v.filled_count}/{v.item_count}{v.created_at ? ` (${new Date(v.created_at).toLocaleDateString("fr-FR")})` : ""}
                </option>
              ))}
            </select>
          </div>
          {/* Modèle LLM */}
          <div>
            <label className="block text-xs font-medium text-[#6A6A6A] mb-1.5">Modèle LLM</label>
            <select value={provider} onChange={e => setProvider(e.target.value)}
              className="border border-[#E0E0E0] px-3 py-2 text-sm w-full focus:outline-none focus:border-[#A100FF]">
              {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {/* Upload CG */}
        <div>
          <label className="block text-xs font-medium text-[#6A6A6A] mb-1.5">
            Conditions Générales <span className="font-normal text-[#9ca3af]">(PDF ou Word)</span>
          </label>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <FileUpload label="Déposer les Conditions Générales…" accept=".pdf,.docx,.doc"
                file={fileCG} onChange={setFileCG} />
            </div>
            <button onClick={() => mutation.mutate()} disabled={!canRun || mutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50 h-[48px] px-5 shrink-0">
              {mutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin"/>Analyse en cours…</>
                : <><ShieldCheck className="w-4 h-4"/>Lancer l&apos;analyse</>
              }
            </button>
          </div>
        </div>

        {mutation.isError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(mutation.error as any)?.response?.data?.detail ?? String((mutation.error as Error)?.message)}
          </p>
        )}
      </div>

      {/* ── Résultats ── */}
      {result && (
        <div className="space-y-4">
          {/* Score + KPIs + Valider */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-wrap">
              {/* Score */}
              <div className={`flex items-center gap-2 px-4 py-2 border rounded ${
                result.score_conformite >= 80 ? "bg-green-50 border-green-200 text-green-700" :
                result.score_conformite >= 60 ? "bg-yellow-50 border-yellow-200 text-yellow-700" :
                "bg-red-50 border-red-200 text-red-700"
              }`}>
                <ShieldCheck className="w-4 h-4 shrink-0"/>
                <span className="text-2xl font-bold">{result.score_conformite}%</span>
                <span className="text-xs">conformité</span>
              </div>
              {/* KPI chips */}
              {(Object.keys(STATUT_CFG) as SKey[]).map(k => (
                result.summary[k] > 0 && (
                  <div key={k} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border ${STATUT_CFG[k].bg} ${STATUT_CFG[k].text} ${STATUT_CFG[k].border}`}>
                    <span className="font-bold">{result.summary[k]}</span>
                    <span>{STATUT_CFG[k].label}</span>
                  </div>
                )
              ))}
              <div className="text-xs text-[#6A6A6A]">
                {result.total_engagements} engagements · {result.articles.length} articles
              </div>
            </div>
            {productId && <ValidateButton productId={productId} />}
          </div>

          {/* Résumé IA */}
          {result.resume && (
            <div className="flex items-start gap-2 bg-[#F9F6FF] border border-[#E0CCFF] px-4 py-3 text-xs text-[#3D3D3D] rounded">
              <Sparkles className="w-3.5 h-3.5 text-[#A100FF] shrink-0 mt-0.5"/>
              <span>{result.resume}</span>
            </div>
          )}

          {/* Filtres */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[#6A6A6A]">Statut :</span>
            <button onClick={() => setFilterStatut("")}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${!filterStatut ? "bg-[#A100FF] text-white border-[#A100FF]" : "bg-[#F2F2F2] text-[#6A6A6A] border-[#E0E0E0]"}`}>
              Tous ({result.total_engagements})
            </button>
            {(Object.keys(STATUT_CFG) as SKey[]).map(s => result.summary[s] > 0 && (
              <button key={s} onClick={() => setFilterStatut(filterStatut === s ? "" : s)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${filterStatut === s ? `${STATUT_CFG[s].bg} ${STATUT_CFG[s].text} border-current` : "bg-[#F2F2F2] text-[#6A6A6A] border-[#E0E0E0]"}`}>
                {STATUT_CFG[s].label} ({result.summary[s]})
              </button>
            ))}
            <span className="text-xs text-[#6A6A6A] ml-2">Risque :</span>
            {Object.keys(RISQUE_CFG).map(r => {
              const count = allEngagements.filter(e => e.risque_type === r).length;
              if (!count) return null;
              return (
                <button key={r} onClick={() => setFilterRisque(filterRisque === r ? "" : r)}
                  className={`text-xs px-2 py-1 rounded-full border transition-colors ${filterRisque === r ? RISQUE_CFG[r].color : "bg-[#F2F2F2] text-[#6A6A6A] border-[#E0E0E0]"}`}>
                  {RISQUE_CFG[r].label} ({count})
                </button>
              );
            })}
          </div>

          {/* Toggle vue */}
          <div className="flex items-center gap-2">
            <button onClick={() => setViewMode("articles")}
              className={`text-xs px-3 py-1.5 border transition-colors ${viewMode === "articles" ? "bg-[#A100FF] text-white border-[#A100FF]" : "bg-white text-[#6A6A6A] border-[#E0E0E0] hover:border-[#A100FF]/50"}`}>
              Vue par article
            </button>
            <button onClick={() => setViewMode("table")}
              className={`text-xs px-3 py-1.5 border transition-colors ${viewMode === "table" ? "bg-[#A100FF] text-white border-[#A100FF]" : "bg-white text-[#6A6A6A] border-[#E0E0E0] hover:border-[#A100FF]/50"}`}>
              Vue tableau
            </button>
          </div>

          {/* ── Vue par article ── */}
          {viewMode === "articles" && (
            <div className="flex gap-4 bg-white border border-[#E0E0E0] rounded overflow-hidden" style={{ minHeight: 480 }}>
              {/* Liste articles */}
              <div className="w-64 shrink-0 border-r border-[#E0E0E0] overflow-y-auto">
                <div className="px-3 py-2 bg-[#F9F6FF] border-b border-[#E0E0E0] text-[11px] font-semibold text-[#6A6A6A] uppercase tracking-wide">
                  Articles ({filteredArticles.length})
                </div>
                {filteredArticles.map(art => {
                  const ws = worstStatus(art);
                  const isSelected = selectedArticle === art.article;
                  return (
                    <button key={art.article} onClick={() => setSelectedArticle(art.article)}
                      className={`w-full text-left px-3 py-2.5 border-b border-[#F2F2F2] transition-colors group ${isSelected ? "bg-[#F3E0FF] border-l-2 border-l-[#A100FF]" : "hover:bg-[#F9F6FF]"}`}>
                      <div className="text-xs font-medium text-black leading-snug truncate">{art.article}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUT_CFG[ws].bg} ${STATUT_CFG[ws].text} ${STATUT_CFG[ws].border}`}>
                          {STATUT_CFG[ws].label}
                        </span>
                        <span className="text-[10px] text-[#9ca3af]">{art.engagements.length} eng.</span>
                      </div>
                    </button>
                  );
                })}
                {filteredArticles.length === 0 && (
                  <div className="px-3 py-6 text-xs text-center text-[#9ca3af]">Aucun article avec ce filtre.</div>
                )}
              </div>

              {/* Détail article */}
              <div className="flex-1 overflow-y-auto p-4">
                {currentArticle ? (
                  <>
                    {/* Navigation */}
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-bold text-black">{currentArticle.article}</h2>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            const prev = filteredArticles[currentArticleIdx - 1];
                            if (prev) setSelectedArticle(prev.article);
                          }}
                          disabled={currentArticleIdx <= 0}
                          className="p-1 border border-[#E0E0E0] text-[#6A6A6A] hover:border-[#A100FF] disabled:opacity-30">
                          <ChevronLeft className="w-4 h-4"/>
                        </button>
                        <span className="text-xs text-[#6A6A6A] px-2">
                          {currentArticleIdx + 1} / {filteredArticles.length}
                        </span>
                        <button
                          onClick={() => {
                            const next = filteredArticles[currentArticleIdx + 1];
                            if (next) setSelectedArticle(next.article);
                          }}
                          disabled={currentArticleIdx >= filteredArticles.length - 1}
                          className="p-1 border border-[#E0E0E0] text-[#6A6A6A] hover:border-[#A100FF] disabled:opacity-30">
                          <ChevronRight className="w-4 h-4"/>
                        </button>
                      </div>
                    </div>

                    {/* Engagements */}
                    <div className="space-y-3">
                      {currentArticle.engagements.map((eng, i) => {
                        const sk = eng.statut as SKey;
                        return (
                          <div key={i} className={`border rounded p-3 space-y-2 ${STATUT_CFG[sk]?.border ?? "border-gray-200"}`}>
                            {/* En-tête engagement */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="text-xs font-semibold text-black leading-snug">{eng.engagement}</div>
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <StatutBadge statut={sk} />
                                <RisqueBadge type={eng.risque_type} niveau={eng.risque_niveau} />
                              </div>
                            </div>

                            {/* Citation CG */}
                            {eng.citation_cg && (
                              <div className="border-l-2 border-[#A100FF]/30 pl-2 text-[11px] text-[#5A5A5A] italic bg-[#FAFAFA] py-1 pr-2 rounded-r">
                                &ldquo;{eng.citation_cg}&rdquo;
                              </div>
                            )}

                            {/* Référence FPP */}
                            {eng.reference_fpp && (
                              <div className="text-[11px]">
                                <span className="font-semibold text-[#6A6A6A]">FPP : </span>
                                <span className="text-[#3D3D3D]">{eng.reference_fpp}</span>
                              </div>
                            )}

                            {/* Explication */}
                            {eng.explication && (
                              <div className="flex items-start gap-1.5 text-[11px] text-[#3D3D3D]">
                                <Sparkles className="w-3 h-3 text-[#A100FF] shrink-0 mt-0.5"/>
                                <span>{eng.explication}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-[#9ca3af]">
                    Sélectionnez un article.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Vue tableau ── */}
          {viewMode === "table" && (
            <div className="bg-white border border-[#E0E0E0] rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#FAFAFA] text-[#6A6A6A] border-b border-[#E0E0E0]">
                    <th className="text-left px-3 py-2 w-36">Article</th>
                    <th className="text-left px-3 py-2 w-52">Engagement</th>
                    <th className="text-left px-3 py-2 w-28">Statut</th>
                    <th className="text-left px-3 py-2 w-28">Risque</th>
                    <th className="text-left px-3 py-2 w-36">Référence FPP</th>
                    <th className="text-left px-3 py-2">Explication</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2F2F2]">
                  {filtered.map((eng, i) => {
                    const sk = eng.statut as SKey;
                    return (
                      <tr key={i} className={`hover:bg-[#F9F6FF]/60 ${STATUT_CFG[sk]?.bg ?? ""}`}>
                        <td className="px-3 py-2 text-[#A100FF] font-medium text-[11px] align-top">{eng.article}</td>
                        <td className="px-3 py-2 font-medium text-black align-top">{eng.engagement}</td>
                        <td className="px-3 py-2 align-top"><StatutBadge statut={sk} /></td>
                        <td className="px-3 py-2 align-top"><RisqueBadge type={eng.risque_type} niveau={eng.risque_niveau} /></td>
                        <td className="px-3 py-2 text-[#6A6A6A] text-[11px] align-top">{eng.reference_fpp || "—"}</td>
                        <td className="px-3 py-2 text-[#6A6A6A] max-w-[280px] align-top">
                          {eng.explication && <span className="block" title={eng.explication}>{eng.explication}</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-sm text-[#9ca3af] py-8">Aucun résultat.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
