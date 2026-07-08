"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wand2, Download, AlertTriangle, CheckCircle, ChevronDown, ChevronRight,
  FileText, Trash2, History, BookOpen, Filter, XCircle, Info, Pencil, X, Clock,
} from "lucide-react";
import {
  productsApi, documentsApi, ficheDirectApi, reportingApi,
  type Product, type Document, type FicheDirectItem, type DocWarning, type FicheDirectVersion,
  type FicheExtraInfoItem, type FicheItemHistoryEntry,
} from "@/lib/api";

function ValidateButton({ productId }: { productId: number }) {
  const [validated, setValidated] = useState(false);
  const mut = useMutation({
    mutationFn: () => reportingApi.validateModule(productId, "fiche"),
    onSuccess: () => setValidated(true),
  });
  if (validated) {
    return (
      <span className="btn-secondary flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border-green-200">
        <CheckCircle className="w-3.5 h-3.5" /> Validé
      </span>
    );
  }
  return (
    <button onClick={() => mut.mutate()} disabled={mut.isPending}
      className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-50">
      <CheckCircle className="w-3.5 h-3.5" />
      {mut.isPending ? "…" : "Valider la fiche"}
    </button>
  );
}
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";

const NO_VALUE_DISPLAY = "Aucune regle mentionnee dans les documents analyses";

// ── Statut IA config ─────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  "A verifier":              { label: "À vérifier",              bg: "bg-amber-50",  text: "text-amber-700",  dot: "bg-amber-400" },
  "Information manquante":   { label: "Non détectée par IA",     bg: "bg-[#F2F2F2]", text: "text-[#6A6A6A]",  dot: "bg-[#BDBDBD]" },
  "Sources contradictoires": { label: "Sources contradictoires", bg: "bg-red-50",    text: "text-[#FF3333]",  dot: "bg-[#FF3333]" },
};

// ── Statut métier config ──────────────────────────────────────────────────────
const USER_STATUS_CFG: Record<string, { label: string; activeCls: string; inactiveCls: string; badgeCls: string }> = {
  genere:         { label: "Généré",       activeCls: "bg-[#374151] text-white border-[#374151] shadow",       inactiveCls: "bg-[#F3F4F6] text-[#6B7280] border-[#D1D5DB] hover:bg-[#E5E7EB] hover:text-[#374151]",           badgeCls: "bg-[#F3F4F6] text-[#374151] border-[#D1D5DB]" },
  a_arbitrer:     { label: "Arbitrage MH", activeCls: "bg-[#EA580C] text-white border-[#EA580C] shadow",       inactiveCls: "bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA] hover:bg-[#FFEDD5] hover:border-[#EA580C]",         badgeCls: "bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]" },
  a_arbitrer_mh:  { label: "Arbitrage MH", activeCls: "bg-[#EA580C] text-white border-[#EA580C] shadow",       inactiveCls: "bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA] hover:bg-[#FFEDD5] hover:border-[#EA580C]",         badgeCls: "bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]" },
  valide_metier:  { label: "Validé",       activeCls: "bg-[#15803D] text-white border-[#15803D] shadow",       inactiveCls: "bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0] hover:bg-[#DCFCE7] hover:border-[#15803D]",         badgeCls: "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]" },
  voir_kapia:     { label: "Voir KAPIA",   activeCls: "bg-[#1D4ED8] text-white border-[#1D4ED8] shadow",       inactiveCls: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE] hover:bg-[#DBEAFE] hover:border-[#1D4ED8]",         badgeCls: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]" },
};

const STATUS_BTNS: { key: string; label: string }[] = [
  { key: "genere",        label: "Généré" },
  { key: "a_arbitrer_mh", label: "Arbitrage MH" },
  { key: "valide_metier", label: "Validé" },
  { key: "voir_kapia",    label: "Voir KAPIA" },
];

function UserStatusBadge({ status }: { status?: string | null }) {
  const cfg = USER_STATUS_CFG[status || "genere"] ?? USER_STATUS_CFG.genere;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded border ${cfg.badgeCls}`}>
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const cfg = STATUS_CONFIG[status || ""] || STATUS_CONFIG["A verifier"];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ── Sources multi-docs ────────────────────────────────────────────────────────
function SourceCitations({ sourceParagraph, sourcePage }: { sourceParagraph?: string | null; sourcePage?: number | null }) {
  if (!sourceParagraph) return null;
  const raw = sourceParagraph;
  let sources: { doc?: string; text?: string; page?: number | null }[] = [];
  if (raw.trimStart().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) sources = parsed;
    } catch { /* plain string fallback */ }
  }
  if (sources.length > 1) {
    return (
      <div className="flex flex-col gap-1 mt-0.5">
        {sources.map((s, i) => (
          <div key={i} className="border-l-2 border-[#A100FF]/30 pl-1.5">
            {s.doc && <span className="text-[9px] font-semibold text-[#A100FF] uppercase tracking-wide block">{s.doc}{s.page ? ` — p.${s.page}` : ""}</span>}
            {s.text && <span className="text-[10px] text-[#6A6A6A] italic leading-snug block">{s.text.length > 160 ? s.text.slice(0, 160) + "…" : s.text}</span>}
          </div>
        ))}
      </div>
    );
  }
  const dashIdx = raw.indexOf(" — ");
  const docPart = dashIdx > -1 ? raw.slice(0, dashIdx) : null;
  const textPart = dashIdx > -1 ? raw.slice(dashIdx + 3) : raw;
  return (
    <div className="border-l-2 border-[#E0E0E0] pl-1.5 mt-0.5">
      {docPart && <span className="text-[9px] font-semibold text-[#A100FF] uppercase tracking-wide block">{docPart}{sourcePage ? ` — p.${sourcePage}` : ""}</span>}
      <span className="text-[10px] text-[#6A6A6A] italic leading-snug block">{textPart.length > 160 ? textPart.slice(0, 160) + "…" : textPart}</span>
    </div>
  );
}

// ── Panneau justificatif étendu ───────────────────────────────────────────────
function JustificatifsPanel({
  item, show, productId, history,
}: {
  item: FicheDirectItem;
  show: boolean;
  productId: number;
  history?: FicheItemHistoryEntry[];
}) {
  if (!show) return null;
  const hasContent = item.source_paragraph || item.source_citation || item.ai_comment
    || item.valeurs_possibles || item.justification || (history && history.length > 0);
  if (!hasContent) return null;

  return (
    <div className="mt-1.5 bg-[#F9F6FF] border border-[#E0CCFF] px-3 py-2 text-[11px] leading-snug space-y-1.5">
      {/* Consigne de saisie */}
      {item.valeurs_possibles && (
        <div>
          <span className="font-semibold text-[#A100FF]">Consigne de saisie : </span>
          <span className="text-[#3D3D3D]">{item.valeurs_possibles}</span>
        </div>
      )}
      {/* Source IA */}
      {(item.source_paragraph || item.source_page) && (
        <div className="flex items-center gap-2 text-[#A100FF] font-medium">
          <FileText className="w-3 h-3 shrink-0" />
          <span className="truncate">{item.source_paragraph || "Document source"}</span>
          {item.source_page && <span className="shrink-0 bg-[#E0CCFF] px-1 text-[10px]">p.{item.source_page}</span>}
        </div>
      )}
      {item.source_citation && (
        <div className="border-l-2 border-[#A100FF]/40 pl-2 text-[10px] text-[#5A5A5A] italic leading-snug">
          &ldquo;{item.source_citation}&rdquo;
        </div>
      )}
      {(item.ai_comment || item.justification) && (
        <div className="text-[#6A6A6A]">
          <span className="font-semibold text-black">Justification IA : </span>
          {item.justification || item.ai_comment}
        </div>
      )}
      {/* Historique corrections */}
      {history && history.length > 0 && (
        <div className="border-t border-[#E0CCFF] pt-1.5 mt-1">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-[#A100FF] mb-1">
            <Clock className="w-3 h-3" /> Historique des corrections
          </div>
          <div className="space-y-1">
            {history.map(h => (
              <div key={h.id} className="flex items-start gap-2 text-[10px] text-[#5A5A5A]">
                <span className="shrink-0 text-[#9A9A9A]">
                  {h.changed_at ? new Date(h.changed_at).toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : "—"}
                </span>
                {h.user_value && <span className="font-medium text-black">{h.user_value}</span>}
                {h.user_comment && <span className="italic text-[#6A6A6A]">— {h.user_comment}</span>}
                {h.user_status && <UserStatusBadge status={h.user_status} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Warning banner ────────────────────────────────────────────────────────────
function WarningBanner({ warnings }: { warnings: DocWarning[] }) {
  const critiques = warnings.filter(w => w.severity === "critique");
  const importants = warnings.filter(w => w.severity === "important");
  const recommandes = warnings.filter(w => w.severity === "recommande");
  if (warnings.length === 0) return null;
  return (
    <div className="card mb-4 border-amber-200 bg-amber-50">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-amber-600" />
        <h3 className="font-semibold text-amber-900">
          {critiques.length > 0
            ? `${critiques.length} document(s) critique(s) manquant(s)`
            : `${importants.length + recommandes.length} document(s) recommandé(s) absent(s)`}
        </h3>
      </div>
      <div className="flex flex-col gap-2">
        {critiques.map((w, i) => (
          <div key={i} className="flex gap-2 p-2 bg-red-50 border border-red-200">
            <XCircle className="w-4 h-4 text-[#FF3333] shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-[#FF3333]">{w.doc_type} — Critique</p>
              <p className="text-xs text-[#3D3D3D]">{w.message}</p>
              <p className="text-[10px] text-[#6A6A6A] italic mt-0.5">{w.recommendation}</p>
            </div>
          </div>
        ))}
        {importants.map((w, i) => (
          <div key={i} className="flex gap-2 p-2 bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-800">{w.doc_type} — Important</p>
              <p className="text-xs text-[#3D3D3D]">{w.message}</p>
              <p className="text-[10px] text-[#6A6A6A] italic mt-0.5">{w.recommendation}</p>
            </div>
          </div>
        ))}
        {recommandes.map((w, i) => (
          <div key={i} className="flex gap-2 p-2 bg-blue-50 border border-blue-100">
            <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-blue-700">{w.doc_type} — Recommandé</p>
              <p className="text-xs text-[#3D3D3D]">{w.message}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page principale ──────────────────────────────────────────────────────────
export default function FicheProduit2Page() {
  const queryClient = useQueryClient();

  const [selectedProduct, setSelectedProduct] = useState<number | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<string>("");
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [generateWarnings, setGenerateWarnings] = useState<DocWarning[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("openai-gpt5");
  const [selectedSheets, setSelectedSheets] = useState<string>("all");
  const [showJustifs, setShowJustifs] = useState(false);
  const [filterSourceDoc, setFilterSourceDoc] = useState<string>("");
  // Correction inline
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editComment, setEditComment] = useState("");
  // Sélection pour validation en masse
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Cache local des corrections (evite rechargement complet)
  const [localPatches, setLocalPatches] = useState<Record<number, { user_value?: string | null; user_comment?: string | null; user_status?: string | null }>>({});
  // Historique par item (chargé à la demande)
  const [historyCache, setHistoryCache] = useState<Record<number, FicheItemHistoryEntry[]>>({});

  const MODEL_OPTIONS = [
    { value: "anthropic",    label: "Claude Sonnet 4.6", sub: "Anthropic — Recommandé" },
    { value: "openai-gpt5", label: "GPT-5",              sub: "OpenAI — Dernière génération" },
    { value: "openai",      label: "GPT-4o",             sub: "OpenAI — Alternative" },
  ];
  const providerBase = selectedProvider.startsWith("anthropic") ? "anthropic" : "openai";

  // ── Queries ──
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => productsApi.list().then(r => r.data),
  });

  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ["documents", selectedProduct],
    queryFn: () => documentsApi.list({ product_id: selectedProduct! }).then(r => r.data),
    enabled: !!selectedProduct,
  });

  const { data: versions = [] } = useQuery<FicheDirectVersion[]>({
    queryKey: ["fiche2-versions", selectedProduct],
    queryFn: () => ficheDirectApi.versions(selectedProduct!).then(r => r.data),
    enabled: !!selectedProduct,
  });

  const effectiveVersion = selectedVersion ?? (versions[0]?.version ?? null);

  const { data: allItems = [], isLoading } = useQuery<FicheDirectItem[]>({
    queryKey: ["fiche2-items", selectedProduct, effectiveVersion],
    queryFn: () => ficheDirectApi.list(selectedProduct!, { version: effectiveVersion ?? undefined }).then(r => r.data),
    enabled: !!selectedProduct && !!effectiveVersion,
  });

  const { data: extraInfo = [] } = useQuery<FicheExtraInfoItem[]>({
    queryKey: ["fiche2-extra-info", selectedProduct, effectiveVersion],
    queryFn: () => ficheDirectApi.extraInfo(selectedProduct!, effectiveVersion ?? undefined).then(r => r.data),
    enabled: !!selectedProduct && !!effectiveVersion,
  });

  // ── Sheets list from items ──
  const SHEETS = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of allItems) {
      if (item.sheet && !seen.has(item.sheet)) { seen.add(item.sheet); result.push(item.sheet); }
    }
    return result;
  }, [allItems]);

  // Set active tab to first sheet when sheets change
  useMemo(() => {
    if (SHEETS.length > 0 && !SHEETS.includes(activeTab)) setActiveTab(SHEETS[0]);
  }, [SHEETS, activeTab]);

  // ── Noms de documents sources distincts (pour le filtre) ──
  const sourceDocuments = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of allItems) {
      if (item.source_paragraph && !seen.has(item.source_paragraph)) {
        seen.add(item.source_paragraph);
        result.push(item.source_paragraph);
      }
    }
    return result.sort();
  }, [allItems]);

  // ── Tab items (filtered) ──
  const tabItems = useMemo(() => {
    if (!activeTab) return [];
    const isUserStatusFilter = ["genere", "a_arbitrer", "a_arbitrer_mh", "valide_metier", "voir_kapia"].includes(filterStatus);
    return allItems.filter(item => {
      if (item.sheet !== activeTab) return false;
      if (filterStatus) {
        if (isUserStatusFilter) {
          const p = localPatches[item.id];
          const us = (p?.user_status !== undefined ? p.user_status : item.user_status) ?? "genere";
          const normalizedUs = us === "a_arbitrer" ? "a_arbitrer_mh" : us;
          const normalizedFilter = filterStatus === "a_arbitrer" ? "a_arbitrer_mh" : filterStatus;
          if (normalizedUs !== normalizedFilter) return false;
        } else {
          if (item.status !== filterStatus) return false;
        }
      }
      if (filterSourceDoc && item.source_paragraph !== filterSourceDoc) return false;
      return true;
    });
  }, [allItems, activeTab, filterStatus, filterSourceDoc, localPatches]);

  const sectionGroups = useMemo(() => {
    const groups: Record<string, FicheDirectItem[]> = {};
    for (const item of tabItems) {
      const sec = item.section || "Général";
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push(item);
    }
    return groups;
  }, [tabItems]);

  // ── Stats ──
  const stats = useMemo(() => {
    const filled = allItems.filter(i => i.status !== "Information manquante").length;
    const missing = allItems.filter(i => i.status === "Information manquante").length;
    const contradictions = allItems.filter(i => i.status === "Sources contradictoires").length;
    const validated = allItems.filter(i => i.status === "Valide").length;
    const itemsWithConfidence = allItems.filter(i => i.confidence_pct != null);
    const avgConfidence = itemsWithConfidence.length > 0
      ? Math.round(itemsWithConfidence.reduce((s, i) => s + (i.confidence_pct ?? 0), 0) / itemsWithConfidence.length)
      : null;
    const completionPct = allItems.length > 0 ? Math.round((filled / allItems.length) * 100) : 0;
    const orphans = extraInfo.filter(e => !e.is_open_point).length;
    const openPoints = extraInfo.filter(e => e.is_open_point).length;
    return { filled, missing, contradictions, validated, total: allItems.length, avgConfidence, completionPct, orphans, openPoints };
  }, [allItems, extraInfo]);

  // ── Mutations ──
  const SHEET_OPTIONS = [
    { value: "all",                        label: "Tous les onglets (séquentiel)" },
    { value: "Produit Technique",          label: "1 — Produit Technique" },
    { value: "Tarif de Rente",             label: "2 — Tarif de Rente" },
    { value: "Garanties et Prestations",   label: "3 — Garanties et Prestations" },
    { value: "Mode de Gestion",            label: "4 — Mode de Gestion" },
  ];

  const sheetsParam = selectedSheets === "all" ? undefined : [selectedSheets];
  const spinnerLabel = selectedSheets === "all"
    ? "Génération en cours (4 onglets séquentiels, 15–25 min)…"
    : `Génération en cours — ${selectedSheets} (3–6 min)…`;

  const generateMutation = useMutation({
    mutationFn: () =>
      ficheDirectApi.generate(selectedProduct!, Array.from(selectedDocIds), providerBase, sheetsParam).then(r => r.data),
    onSuccess: (data) => {
      setIsGenerating(false);
      setGenerateWarnings(data.warnings || []);
      queryClient.invalidateQueries({ queryKey: ["fiche2-versions", selectedProduct] });
      queryClient.invalidateQueries({ queryKey: ["fiche2-items", selectedProduct] });
      queryClient.invalidateQueries({ queryKey: ["fiche2-extra-info", selectedProduct] });
      setSelectedVersion(null);
    },
    onError: () => setIsGenerating(false),
  });

  const handleGenerate = () => {
    setIsGenerating(true);
    generateMutation.mutate();
  };

  const updateDecisionMutation = useMutation({
    mutationFn: ({ itemId, decision }: { itemId: number; decision: string | null }) =>
      ficheDirectApi.updateExtraInfoDecision(selectedProduct!, itemId, decision),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiche2-extra-info", selectedProduct] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (version_number: number) =>
      ficheDirectApi.deleteVersion(selectedProduct!, version_number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiche2-versions", selectedProduct] });
      queryClient.invalidateQueries({ queryKey: ["fiche2-items", selectedProduct] });
      setSelectedVersion(null);
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({ itemId, body }: { itemId: number; body: { user_value?: string | null; user_comment?: string | null; user_status?: string } }) =>
      ficheDirectApi.patchItem(selectedProduct!, itemId, body),
    onSuccess: (res, { itemId }) => {
      const data = (res as { data: { user_value?: string | null; user_comment?: string | null; user_status?: string | null } }).data;
      setLocalPatches(prev => ({ ...prev, [itemId]: { ...prev[itemId], ...data } }));
      // Rafraîchit l'historique du champ
      ficheDirectApi.itemHistory(selectedProduct!, itemId).then(r => {
        setHistoryCache(prev => ({ ...prev, [itemId]: r.data }));
      });
    },
  });

  const bulkValidateMutation = useMutation({
    mutationFn: (ids: number[]) => ficheDirectApi.bulkValidate(selectedProduct!, ids),
    onSuccess: (_, ids) => {
      const patch = { user_status: "valide_metier" as const };
      setLocalPatches(prev => {
        const next = { ...prev };
        ids.forEach(id => { next[id] = { ...next[id], ...patch }; });
        return next;
      });
      setSelectedIds(new Set());
    },
  });

  const startEdit = (item: FicheDirectItem) => {
    const patched = localPatches[item.id] ?? {};
    setEditingId(item.id);
    setEditValue(patched.user_value ?? item.user_value ?? "");
    setEditComment(patched.user_comment ?? item.user_comment ?? "");
    // Charge l'historique si pas encore en cache
    if (!historyCache[item.id]) {
      ficheDirectApi.itemHistory(selectedProduct!, item.id).then(r => {
        setHistoryCache(prev => ({ ...prev, [item.id]: r.data }));
      });
    }
  };

  const saveEdit = (item: FicheDirectItem) => {
    const body: { user_value?: string | null; user_comment?: string | null; user_status?: string } = {
      user_value: editValue.trim() || null,
      user_comment: editComment.trim() || null,
    };
    const current = localPatches[item.id]?.user_status ?? item.user_status;
    if (!current || current === "genere") body.user_status = "a_arbitrer";
    patchMutation.mutate({ itemId: item.id, body });
    setEditingId(null);
  };

  const validateItem = (item: FicheDirectItem) => {
    patchMutation.mutate({ itemId: item.id, body: { user_status: "valide_metier" } });
  };

  const toggleSelectId = (id: number) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleDoc = (id: number) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const currentVersionWarnings = useMemo(() => {
    const v = versions.find(v => v.version === effectiveVersion);
    return v?.warnings || generateWarnings;
  }, [versions, effectiveVersion, generateWarnings]);

  return (
    <div className="p-6 space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-black">Fiche Produit</h1>
          <p className="text-xs text-[#6A6A6A] mt-0.5">Analysez et validez les paramètres détectés par rapport au référentiel.</p>
        </div>
        <div className="flex gap-2">
          {effectiveVersion && selectedProduct && (
            <>
              <button
                onClick={() => setShowVersionHistory(!showVersionHistory)}
                className="btn-secondary flex items-center gap-1.5 text-xs"
              >
                <History className="w-3.5 h-3.5" />
                Historique
              </button>
              <a
                href={ficheDirectApi.exportExcel(selectedProduct)}
                className="btn-secondary flex items-center gap-1.5 text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                Export Excel
              </a>
              <ValidateButton productId={selectedProduct} />
            </>
          )}
        </div>
      </div>

      {/* ── Sélection produit + documents ── */}
      <div className="card">
        <div className="grid grid-cols-2 gap-4">
          {/* Produit */}
          <div>
            <label className="block text-xs font-medium text-[#6A6A6A] mb-1.5">Produit</label>
            <select
              value={selectedProduct ?? ""}
              onChange={e => {
                setSelectedProduct(e.target.value ? Number(e.target.value) : null);
                setSelectedDocIds(new Set());
                setSelectedVersion(null);
                setGenerateWarnings([]);
                setIsGenerating(false);
                setFilterSourceDoc("");
              }}
              className="w-full border border-[#E0E0E0] px-3 py-2 text-sm focus:outline-none focus:border-[#A100FF]"
            >
              <option value="">-- Sélectionner un produit --</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.boss_number}{p.name ? ` — ${p.name}` : ""}
                </option>
              ))}
            </select>
          </div>

        </div>

        {/* Documents disponibles */}
        {selectedProduct && documents.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-[#6A6A6A]">
                Documents à analyser ({selectedDocIds.size}/{documents.length} sélectionnés)
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedDocIds(new Set(documents.map(d => d.id)))}
                  className="text-xs text-[#A100FF] hover:underline"
                >
                  Tout sélectionner
                </button>
                <button
                  onClick={() => setSelectedDocIds(new Set())}
                  className="text-xs text-[#6A6A6A] hover:underline"
                >
                  Désélectionner
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
              {documents.map(doc => {
                const checked = selectedDocIds.has(doc.id);
                const catLower = (doc.category || "").toLowerCase();
                const isCritical = catLower.includes("note technique") || catLower.includes("conditions g");
                return (
                  <label
                    key={doc.id}
                    className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer border transition-colors ${
                      checked
                        ? "border-[#A100FF] bg-[#F3E0FF]"
                        : "border-[#E0E0E0] hover:border-[#A100FF]/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDoc(doc.id)}
                      className="accent-[#A100FF]"
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-medium text-black truncate">{doc.original_filename}</span>
                      <span className={`text-[10px] ${isCritical ? "text-[#A100FF] font-medium" : "text-[#6A6A6A]"}`}>
                        {doc.category || "Non classifié"}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-[#6A6A6A]">Modèle :</span>
                <select
                  value={selectedProvider}
                  onChange={e => setSelectedProvider(e.target.value)}
                  disabled={isGenerating}
                  className="text-xs border border-[#E0E0E0] px-2 py-1 bg-white text-[#3D3D3D] disabled:opacity-50 focus:outline-none focus:border-[#A100FF]"
                >
                  {MODEL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} title={opt.sub}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-[#6A6A6A]">Onglet(s) :</span>
                <select
                  value={selectedSheets}
                  onChange={e => setSelectedSheets(e.target.value)}
                  disabled={isGenerating}
                  className="text-xs border border-[#E0E0E0] px-2 py-1 bg-white text-[#3D3D3D] disabled:opacity-50 focus:outline-none focus:border-[#A100FF]"
                >
                  {SHEET_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleGenerate}
                disabled={selectedDocIds.size === 0 || isGenerating}
                className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-50 shrink-0"
              >
                <Wand2 className="w-3.5 h-3.5" />
                {isGenerating ? "Génération…" : "Générer la FPP"}
              </button>

              {/* ── Récap documents sélectionnés ── */}
              {selectedDocIds.size > 0 && (() => {
                const selDocs = documents.filter(d => selectedDocIds.has(d.id));
                const totalPages = selDocs.reduce((s, d) => s + (d.page_count || 0), 0);
                const totalMo = selDocs.reduce((s, d) => s + (d.file_size || 0), 0) / (1024 * 1024);
                const noText = selDocs.filter(d => !d.page_count || d.page_count === 0);
                const isCriticalCat = (c?: string) => {
                  const l = (c || "").toLowerCase();
                  return l.includes("note technique") || l.includes("conditions g");
                };
                return (
                  <div className="border border-[#E0E0E0] text-xs">
                    {/* Totaux */}
                    <div className="flex items-center justify-between px-3 py-1.5 bg-[#F2F2F2] border-b border-[#E0E0E0]">
                      <span className="font-medium text-[#3D3D3D]">Documents sélectionnés</span>
                      <div className="flex gap-4 text-[#6A6A6A]">
                        <span><span className="font-bold text-black">{selDocs.length}</span> doc{selDocs.length > 1 ? "s" : ""}</span>
                        <span><span className="font-bold text-black">{totalPages}</span> pages</span>
                        <span><span className="font-bold text-black">{totalMo.toFixed(1)}</span> Mo</span>
                      </div>
                    </div>
                    {/* Ligne par document */}
                    {selDocs.map(doc => {
                      const hasText = doc.page_count && doc.page_count > 0;
                      const critical = isCriticalCat(doc.category);
                      return (
                        <div key={doc.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-[#F2F2F2] last:border-0">
                          {hasText
                            ? <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="Texte extrait" />
                            : <span className="w-2 h-2 rounded-full bg-[#FF3333] shrink-0" title="Aucun texte extrait" />
                          }
                          <span className="truncate font-medium text-black flex-1 min-w-0" title={doc.original_filename}>
                            {doc.original_filename}
                          </span>
                          <span className={`shrink-0 ${critical ? "text-[#A100FF] font-medium" : "text-[#6A6A6A]"}`}>
                            {doc.category || "Non classifié"}
                          </span>
                          <span className="shrink-0 text-[#6A6A6A] w-16 text-right">
                            {hasText
                              ? <span className="text-black font-medium">{doc.page_count} p.</span>
                              : <span className="text-[#FF3333] font-medium">0 p.</span>
                            }
                          </span>
                          <span className="shrink-0 text-[#9A9A9A] w-14 text-right">
                            {doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} Ko` : "—"}
                          </span>
                        </div>
                      );
                    })}
                    {/* Alerte si texte manquant */}
                    {noText.length > 0 && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border-t border-red-100 text-[#FF3333]">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {noText.length} doc{noText.length > 1 ? "s" : ""} sans texte extrait ({noText.map(d => d.original_filename).join(", ")}) — Re-extraire depuis la gestion documentaire
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {isGenerating && (
                <div className="flex items-center gap-3 text-xs text-[#6A6A6A] bg-[#F9F6FF] border border-[#E0CCFF] px-3 py-2">
                  <span className="inline-block w-3 h-3 border-2 border-[#A100FF] border-t-transparent rounded-full animate-spin shrink-0" />
                  {spinnerLabel}
                </div>
              )}

              {generateMutation.isError && (
                <p className="text-xs text-[#FF3333]">
                  Erreur :{" "}
                  {String(
                    (generateMutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
                    generateMutation.error
                  )}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Historique des versions ── */}
      {showVersionHistory && versions.length > 0 && (
        <div className="card mb-2">
          <h3 className="font-semibold text-sm text-black mb-3 flex items-center gap-2">
            <History className="w-4 h-4 text-[#A100FF]" />
            Historique des analyses
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E0E0E0] bg-[#F2F2F2]">
                  <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Version</th>
                  <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Date</th>
                  <th className="text-center px-3 py-2 font-medium text-[#6A6A6A]">Champs</th>
                  <th className="text-center px-3 py-2 font-medium text-[#6A6A6A]">Renseignés</th>
                  <th className="text-center px-3 py-2 font-medium text-[#6A6A6A]">Règles extraites</th>
                  <th className="text-center px-3 py-2 font-medium text-[#6A6A6A]">Alertes</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F2F2]">
                {versions.map(v => (
                  <tr
                    key={v.version}
                    className={`cursor-pointer hover:bg-[#F2F2F2] ${effectiveVersion === v.version ? "bg-[#F3E0FF]" : ""}`}
                    onClick={() => { setSelectedVersion(v.version); setShowVersionHistory(false); }}
                  >
                    <td className="px-3 py-2 font-medium text-[#A100FF]">{v.label}</td>
                    <td className="px-3 py-2 text-xs text-[#6A6A6A]">
                      {v.created_at ? new Date(v.created_at).toLocaleString("fr-FR") : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">{v.item_count}</td>
                    <td className="px-3 py-2 text-center text-green-700 font-medium">{v.filled_count}</td>
                    <td className="px-3 py-2 text-center text-[#A100FF]">{v.ref_rules_count}</td>
                    <td className="px-3 py-2 text-center">
                      {v.warnings.filter(w => w.severity === "critique").length > 0 ? (
                        <span className="text-xs text-[#FF3333] font-medium">
                          {v.warnings.filter(w => w.severity === "critique").length} critique(s)
                        </span>
                      ) : (
                        <span className="text-xs text-green-600">OK</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={e => { e.stopPropagation(); if (confirm(`Supprimer V${v.version} ?`)) deleteMutation.mutate(v.version); }}
                        className="text-[#FF3333] hover:bg-red-50 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Alertes documents manquants supprimées */}

      {/* ── Filtres + onglets ── */}
      {allItems.length > 0 && (
        <div className="card p-0">
          {/* Barre de filtres */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-[#E0E0E0] bg-[#FAFAFA] flex-wrap">
            <Filter className="w-3.5 h-3.5 text-[#6A6A6A] shrink-0" />
            <span className="text-xs text-[#6A6A6A] shrink-0">Statut :</span>
            {["", "A verifier", "Sources contradictoires", "Information manquante", "genere", "a_arbitrer", "valide_metier", "voir_kapia"].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`text-xs px-2 py-0.5 transition-colors shrink-0 ${
                  filterStatus === s
                    ? "bg-[#A100FF] text-white"
                    : "bg-[#F2F2F2] text-[#6A6A6A] hover:bg-[#E0E0E0]"
                }`}
              >
                {s === "" ? "Tous" : STATUS_CONFIG[s]?.label || USER_STATUS_CFG[s]?.label || s}
              </button>
            ))}
            {sourceDocuments.length > 0 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[#D0D0D0]">|</span>
                <span className="text-xs text-[#6A6A6A] whitespace-nowrap">Doc source :</span>
                <select
                  value={filterSourceDoc}
                  onChange={e => setFilterSourceDoc(e.target.value)}
                  className="text-xs border border-[#E0E0E0] px-2 py-0.5 bg-white text-[#3D3D3D] focus:outline-none focus:border-[#A100FF] max-w-[200px]"
                  style={{ borderRadius: 0 }}
                >
                  <option value="">Tous les documents</option>
                  {sourceDocuments.map(doc => (
                    <option key={doc} value={doc}>{doc}</option>
                  ))}
                </select>
                {filterSourceDoc && (
                  <button onClick={() => setFilterSourceDoc("")} className="text-xs text-[#6A6A6A] hover:text-black">✕</button>
                )}
              </div>
            )}
            <div className="flex-1" />
            <button
              onClick={() => setShowJustifs(v => !v)}
              className={`text-xs px-3 py-0.5 border transition-colors shrink-0 ${
                showJustifs
                  ? "border-[#A100FF] bg-[#F3E0FF] text-[#A100FF] font-medium"
                  : "border-[#E0E0E0] text-[#6A6A6A] hover:border-[#A100FF]/40"
              }`}
            >
              {showJustifs ? "Masquer détail" : "Détail"}
            </button>
          </div>

          {/* Onglets feuilles + Non pris en compte */}
          <div className="flex overflow-x-auto border-b border-[#E0E0E0] scrollbar-none">
            {SHEETS.map(sheet => (
              <button
                key={sheet}
                onClick={() => setActiveTab(sheet)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === sheet
                    ? "border-[#A100FF] text-[#A100FF]"
                    : "border-transparent text-[#6A6A6A] hover:text-black"
                }`}
              >
                {sheet}
                {(() => {
                  const sheetItems = allItems.filter(i => i.sheet === sheet);
                  const nbFilled = sheetItems.filter(i => i.status !== "Information manquante").length;
                  return (
                    <span className="ml-1.5 text-[10px] text-[#6A6A6A]">{nbFilled}/{sheetItems.length}</span>
                  );
                })()}
              </button>
            ))}
            {extraInfo.length > 0 && (
              <button
                onClick={() => setActiveTab("__extra__")}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === "__extra__"
                    ? "border-amber-500 text-amber-700"
                    : "border-transparent text-amber-600 hover:text-amber-800"
                }`}
              >
                Infos complémentaires
                <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5">{extraInfo.length}</span>
              </button>
            )}
          </div>

          {/* ── Compteurs de statuts métier ── */}
          {activeTab && activeTab !== "__extra__" && (() => {
            const tabAll = allItems.filter(i => i.sheet === activeTab);
            const counts: Record<string, number> = { genere: 0, a_arbitrer_mh: 0, valide_metier: 0, voir_kapia: 0 };
            tabAll.forEach(item => {
              const p = localPatches[item.id];
              const us = (p?.user_status !== undefined ? p.user_status : item.user_status) ?? "genere";
              const k = us === "a_arbitrer" ? "a_arbitrer_mh" : us;
              if (k in counts) counts[k]++;
              else counts.genere++;
            });
            return (
              <div className="flex items-center gap-2 px-4 py-1.5 border-t border-[#E0E0E0] bg-[#FAFAFA] flex-wrap">
                {([
                  { key: "genere",        label: "Généré",       color: "#6B7280", bg: "#F3F4F6", border: "#D1D5DB" },
                  { key: "a_arbitrer_mh", label: "Arbitrage MH", color: "#D97706", bg: "#FFF7ED", border: "#FED7AA" },
                  { key: "valide_metier", label: "Validé",       color: "#16A34A", bg: "#F0FDF4", border: "#BBF7D0" },
                  { key: "voir_kapia",    label: "Voir KAPIA",   color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE" },
                ] as { key: string; label: string; color: string; bg: string; border: string }[]).map(({ key, label, color, bg, border }) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border"
                    style={{ backgroundColor: bg, color, borderColor: border }}
                  >
                    <span className="font-semibold">{counts[key] ?? 0}</span>
                    <span>{label}</span>
                  </span>
                ))}
                <span className="text-[11px] text-[#9CA3AF] ml-0.5">/ {tabAll.length}</span>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Contenu par section ── */}
      {activeTab && tabItems.length > 0 && (
        <>
          {Object.entries(sectionGroups).map(([section, sectionItems]) => (
            <div key={section} className="card mb-4">
              <h3 className="font-semibold text-black mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-[#A100FF] rounded-full" />
                {section}
                <span className="text-xs font-normal text-[#6A6A6A]">({sectionItems.length})</span>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E0E0E0] bg-[#F2F2F2]">
                      <th className="px-3 py-2 w-8">
                        <input type="checkbox"
                          className="accent-[#A100FF]"
                          checked={sectionItems.every(i => selectedIds.has(i.id))}
                          onChange={e => {
                            const next = new Set(selectedIds);
                            sectionItems.forEach(i => e.target.checked ? next.add(i.id) : next.delete(i.id));
                            setSelectedIds(next);
                          }}
                        />
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A] w-40">Paramètre KELIA</th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A] w-64">Valeur à renseigner</th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A] w-56">Commentaire</th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A] whitespace-nowrap">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F2F2]">
                    {sectionItems.map((item, idx) => {
                      const isNoValue = !item.value || item.value === NO_VALUE_DISPLAY || item.status === "Information manquante";
                      const isContra = item.status === "Sources contradictoires";
                      const prevItem = idx > 0 ? sectionItems[idx - 1] : null;
                      const nextItem = idx < sectionItems.length - 1 ? sectionItems[idx + 1] : null;
                      const isContinuation = isContra && prevItem?.parameter === item.parameter && prevItem?.status === "Sources contradictoires";
                      const hasNext = isContra && nextItem?.parameter === item.parameter && nextItem?.status === "Sources contradictoires";
                      const patched = localPatches[item.id] ?? {};
                      const displayValue = patched.user_value !== undefined ? patched.user_value : item.user_value;
                      const displayComment = patched.user_comment !== undefined ? patched.user_comment : item.user_comment;
                      const displayStatus = patched.user_status !== undefined ? patched.user_status : item.user_status;
                      const isEditing = editingId === item.id;
                      return (
                            <tr
                              key={item.id}
                              className={
                                isContra
                                  ? "bg-red-50 border-l-2 border-l-[#FF3333]"
                                  : "hover:bg-[#FAFAFA]"
                              }
                            >
                              {/* Checkbox */}
                              <td className="px-3 py-2 align-top">
                                <input type="checkbox" className="accent-[#A100FF]"
                                  checked={selectedIds.has(item.id)}
                                  onChange={() => toggleSelectId(item.id)} />
                              </td>
                              {/* Paramètre */}
                              <td className="px-3 py-2 font-medium text-black align-top text-sm">
                                {isContinuation ? (
                                  <span className="text-[11px] text-[#FF3333] pl-2 italic">↳ {item.parameter}</span>
                                ) : (
                                  <div>
                                    {item.parameter}
                                    {hasNext && <span className="ml-1.5 text-[10px] bg-red-100 text-[#FF3333] px-1 font-normal">contradiction</span>}
                                  </div>
                                )}
                              </td>
                              {/* Valeur IA */}
                              <td className="px-3 py-2 align-top">
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {isNoValue ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-[#F2F2F2] text-[#6A6A6A] font-medium rounded">
                                        <span className="w-1.5 h-1.5 rounded-full bg-[#BDBDBD] shrink-0" />
                                        Non détectée par IA
                                      </span>
                                    ) : (
                                      <>
                                        <span className={`text-sm ${displayValue ? "line-through text-[#9A9A9A]" : "text-black"}`}>{item.value}</span>
                                        {item.confidence_pct != null && (
                                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                            item.confidence_pct >= 80 ? "bg-green-100 text-green-700" :
                                            item.confidence_pct >= 50 ? "bg-amber-100 text-amber-700" :
                                            "bg-red-100 text-red-600"}`}>
                                            {item.confidence_pct}%
                                          </span>
                                        )}
                                        {item.status === "Sources contradictoires" && (
                                          <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-[#FF3333] font-medium rounded">contradiction</span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                  {!isNoValue && <JustificatifsPanel item={item} show={showJustifs} productId={selectedProduct!}
                                    history={historyCache[item.id]} />}
                                </div>
                              </td>
                              {/* Correction */}
                              <td className="px-3 py-2 align-top w-52">
                                {isEditing ? (
                                  <div className="flex flex-col gap-1.5">
                                    <input autoFocus
                                      className="border border-[#A100FF] px-2 py-1 text-sm w-full focus:outline-none"
                                      value={editValue}
                                      onChange={e => setEditValue(e.target.value)}
                                      onKeyDown={e => { if (e.key === "Enter") saveEdit(item); if (e.key === "Escape") setEditingId(null); }}
                                      placeholder="Nouvelle valeur…"
                                    />
                                    <input
                                      className="border border-[#E0E0E0] px-2 py-1 text-xs w-full focus:outline-none focus:border-[#A100FF]"
                                      value={editComment}
                                      onChange={e => setEditComment(e.target.value)}
                                      onKeyDown={e => { if (e.key === "Enter") saveEdit(item); if (e.key === "Escape") setEditingId(null); }}
                                      placeholder="Commentaire (optionnel)…"
                                    />
                                    <div className="flex gap-1">
                                      <button onClick={() => saveEdit(item)}
                                        className="text-[11px] bg-[#A100FF] text-white px-2 py-0.5 hover:bg-[#8800dd]">
                                        Enregistrer
                                      </button>
                                      <button onClick={() => setEditingId(null)}
                                        className="text-[11px] text-[#6A6A6A] px-2 py-0.5 border border-[#E0E0E0] hover:bg-[#F2F2F2]">
                                        Annuler
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col gap-0.5 group cursor-pointer" onClick={() => startEdit(item)}>
                                    {displayValue ? (
                                      <span className="text-sm font-medium text-[#A100FF]">{displayValue}</span>
                                    ) : (
                                      <span className="text-xs text-[#BDBDBD] italic group-hover:text-[#A100FF] transition-colors">
                                        Cliquer pour corriger…
                                      </span>
                                    )}
                                    {displayComment && <span className="text-[11px] text-[#6A6A6A] italic">{displayComment}</span>}
                                    <Pencil className="w-3 h-3 text-[#BDBDBD] group-hover:text-[#A100FF] transition-colors mt-0.5" />
                                  </div>
                                )}
                              </td>
                              {/* Statut — 4 boutons style 3, une ligne */}
                              <td className="px-2 py-2 align-top">
                                <div className="flex gap-1 flex-nowrap">
                                  {STATUS_BTNS.map(s => {
                                    const cur = displayStatus ?? "genere";
                                    const isActive = cur === s.key || (s.key === "a_arbitrer_mh" && cur === "a_arbitrer");
                                    const activeCls: Record<string,string> = {
                                      genere:        "bg-[#6B7280] text-white",
                                      a_arbitrer_mh: "bg-[#D97706] text-white",
                                      valide_metier: "bg-[#16A34A] text-white",
                                      voir_kapia:    "bg-[#2563EB] text-white",
                                    };
                                    const inactiveCls: Record<string,string> = {
                                      genere:        "bg-[#F3F4F6] text-[#9CA3AF] border border-[#E5E7EB] hover:bg-[#E5E7EB]",
                                      a_arbitrer_mh: "bg-[#FFF7ED] text-[#FCA574] border border-[#FED7AA] hover:bg-[#FFEDD5]",
                                      valide_metier: "bg-[#F0FDF4] text-[#86EFAC] border border-[#BBF7D0] hover:bg-[#DCFCE7]",
                                      voir_kapia:    "bg-[#EFF6FF] text-[#93C5FD] border border-[#BFDBFE] hover:bg-[#DBEAFE]",
                                    };
                                    return (
                                      <button
                                        key={s.key}
                                        onClick={() => patchMutation.mutate({ itemId: item.id, body: { user_status: s.key } })}
                                        className={`text-[10px] px-2 py-0.5 rounded-full transition-all duration-150 whitespace-nowrap font-normal ${
                                          isActive ? activeCls[s.key] : inactiveCls[s.key]
                                        }`}
                                      >
                                        {s.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── Barre flottante validation en masse ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-white border border-[#A100FF] shadow-xl px-5 py-3 rounded-full">
          <span className="text-sm font-semibold text-[#3D3D3D] pr-2 border-r border-[#E0E0E0]">
            {selectedIds.size} champ{selectedIds.size > 1 ? "s" : ""}
          </span>
          {(([
            { status: "valide_metier", label: "Validé",       cls: "bg-[#15803D] text-white hover:bg-[#166534]" },
            { status: "a_arbitrer_mh", label: "Arbitrage MH", cls: "bg-[#EA580C] text-white hover:bg-[#C2410C]" },
            { status: "voir_kapia",    label: "Voir KAPIA",   cls: "bg-[#1D4ED8] text-white hover:bg-[#1E40AF]" },
            { status: "genere",        label: "Généré",       cls: "bg-[#374151] text-white hover:bg-[#1F2937]" },
          ]) as { status: string; label: string; cls: string }[]).map(({ status, label, cls }) => (
            <button
              key={status}
              onClick={() => {
                const ids = Array.from(selectedIds);
                ficheDirectApi.bulkValidate(selectedProduct!, ids, status).then(() => {
                  setLocalPatches(prev => {
                    const next = { ...prev };
                    ids.forEach(id => { next[id] = { ...next[id], user_status: status }; });
                    return next;
                  });
                  setSelectedIds(new Set());
                });
              }}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-all ${cls}`}
            >
              {label}
            </button>
          ))}
          <button onClick={() => setSelectedIds(new Set())} className="text-[#9A9A9A] hover:text-black p-1 ml-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Informations Complémentaires ── */}
      {activeTab === "__extra__" && (
        <div className="space-y-4">
          {/* Points ouverts */}
          {extraInfo.filter(e => e.is_open_point).length > 0 && (
            <div className="card mb-0">
              <h3 className="font-semibold text-black mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-orange-500 rounded-full" />
                Points ouverts
                <span className="text-xs font-normal text-[#6A6A6A]">({extraInfo.filter(e => e.is_open_point).length})</span>
              </h3>
              <div className="space-y-2">
                {extraInfo.filter(e => e.is_open_point).map(item => (
                  <div key={item.id} className="flex gap-3 p-3 bg-orange-50 border border-orange-100">
                    <span className="text-xs font-bold text-orange-700 bg-orange-100 px-2 py-0.5 h-fit shrink-0">{item.open_point_code || "E-?"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-black">{item.parameter}</p>
                      {item.open_point_impact && <p className="text-xs text-[#6A6A6A] mt-0.5">Impact : {item.open_point_impact}</p>}
                      {item.open_point_action && <p className="text-xs text-[#A100FF] mt-0.5 italic">→ {item.open_point_action}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Paramètres orphelins */}
          {extraInfo.filter(e => !e.is_open_point).length > 0 && (
            <div className="card mb-0">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-2 h-2 bg-amber-500 rounded-full" />
                <h3 className="font-semibold text-black">Paramètres présents dans les documents, absents de la FPP</h3>
                <span className="text-xs font-normal text-[#6A6A6A]">({extraInfo.filter(e => !e.is_open_point).length})</span>
              </div>
              <p className="text-xs text-[#6A6A6A] mb-3 italic">
                Ces informations ont été détectées dans vos documents mais n&apos;ont pas de champ correspondant dans la FPP KELIA.
                Décidez pour chacune : ajouter à la FPP, créer un écart KAPIA, ou ignorer.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E0E0E0] bg-amber-50">
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Paramètre</th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Valeur</th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Source</th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Recommandation</th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Décision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F2F2]">
                    {extraInfo.filter(e => !e.is_open_point).map(item => (
                      <tr key={item.id} className={`hover:bg-amber-50/30 ${item.user_decision === "ignored" ? "opacity-40" : ""}`}>
                        <td className="px-3 py-2 font-medium text-black align-top max-w-[200px]">
                          <div>{item.parameter}</div>
                          {item.comment && <div className="text-[10px] text-[#6A6A6A] italic mt-0.5">{item.comment}</div>}
                        </td>
                        <td className="px-3 py-2 align-top max-w-[200px]">
                          <span className="text-black text-xs">{item.value}</span>
                          {item.source_extract && (
                            <p className="text-[10px] text-[#6A6A6A] italic mt-0.5 line-clamp-2 border-l-2 border-amber-200 pl-1.5">{item.source_extract}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-[#6A6A6A] align-top">
                          <div className="font-medium">{item.source_document || "—"}</div>
                          {item.source_page != null && <div className="text-[10px]">p. {item.source_page}</div>}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span className={`text-[10px] px-1.5 py-0.5 font-medium ${
                            item.recommendation === "Ajouter à la FPP" ? "bg-green-100 text-green-700" :
                            item.recommendation === "Créer écart KAPIA" ? "bg-orange-100 text-orange-700" :
                            "bg-[#F2F2F2] text-[#6A6A6A]"
                          }`}>{item.recommendation}</span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex gap-1 flex-wrap">
                            {(["added", "ecart", "ignored"] as const).map(d => (
                              <button
                                key={d}
                                onClick={() => updateDecisionMutation.mutate({ itemId: item.id, decision: item.user_decision === d ? null : d })}
                                className={`text-[10px] px-1.5 py-0.5 border transition-colors ${
                                  item.user_decision === d
                                    ? d === "added" ? "bg-green-500 text-white border-green-500"
                                      : d === "ecart" ? "bg-orange-500 text-white border-orange-500"
                                      : "bg-[#6A6A6A] text-white border-[#6A6A6A]"
                                    : "border-[#E0E0E0] text-[#6A6A6A] hover:border-[#A100FF]/40"
                                }`}
                              >
                                {d === "added" ? "Ajouter FPP" : d === "ecart" ? "Écart KAPIA" : "Ignorer"}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Chargement ── */}
      {isLoading && selectedProduct && (
        <div className="card text-center py-8 text-[#6A6A6A] text-sm">Chargement en cours…</div>
      )}

      {/* ── État vide ── */}
      {!isLoading && selectedProduct && allItems.length === 0 && versions.length === 0 && (
        <div className="card text-center py-10 text-[#6A6A6A]">
          <BookOpen className="w-10 h-10 mx-auto mb-3 text-[#E0E0E0]" />
          <p className="font-medium text-black">Aucune analyse disponible</p>
          <p className="text-sm mt-1">Sélectionnez des documents et lancez l&apos;analyse.</p>
        </div>
      )}

      {!selectedProduct && (
        <div className="card text-center py-10 text-[#6A6A6A]">
          <FileText className="w-10 h-10 mx-auto mb-3 text-[#E0E0E0]" />
          <p className="font-medium text-black">Sélectionnez un produit pour commencer</p>
        </div>
      )}
    </div>
  );
}
