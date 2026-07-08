"use client";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Header } from "@/components/layout/Header";
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";
import {
  productsApi, documentsApi, fichesApi, referentielApi,
  FicheItem, ReferentielVersion, EcartItem, DocReadingReport,
} from "@/lib/api";
import { Wand2, Download, Filter, AlertTriangle, CheckCircle, History, Trash2, FileSearch, BookOpen } from "lucide-react";

const NO_VALUE_DISPLAY = "Aucune règle mentionnée dans les documents analysés";

const SHEETS = [
  "Produit Technique",
  "Tarif de Rente",
  "Garanties et Prestations",
  "Mode de Gestion",
  "Synthèse & Validation",
];

const DOC_COLORS = [
  { bg: "bg-[#F3E0FF]", text: "text-[#7700CC]", dot: "bg-[#A100FF]" },
  { bg: "bg-emerald-100", text: "text-emerald-800", dot: "bg-emerald-500" },
  { bg: "bg-orange-100", text: "text-orange-800", dot: "bg-orange-500" },
  { bg: "bg-teal-100", text: "text-teal-800", dot: "bg-teal-500" },
  { bg: "bg-pink-100", text: "text-pink-800", dot: "bg-pink-500" },
  { bg: "bg-amber-100", text: "text-amber-800", dot: "bg-amber-500" },
  { bg: "bg-cyan-100", text: "text-cyan-800", dot: "bg-cyan-500" },
  { bg: "bg-indigo-100", text: "text-indigo-800", dot: "bg-indigo-500" },
];

type DocColor = (typeof DOC_COLORS)[0];

// ── Composant affichage sources (1 ou N documents) ──────────────────────────
function SourceCitations({
  sourceParagraph,
  sourceCitation,
}: {
  sourceParagraph?: string | null;
  sourceCitation?: string | null;
}) {
  if (!sourceParagraph && !sourceCitation) return null;

  // Detect JSON multi-source array: [{"doc": "...", "text": "...", "doc_id": ...}]
  const raw = sourceParagraph || "";
  let sources: { doc?: string; text?: string }[] = [];

  if (raw.trimStart().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) sources = parsed;
    } catch {
      // not valid JSON — fall through to single-source
    }
  }

  if (sources.length > 1) {
    // Multi-source: render each separately
    return (
      <div className="flex flex-col gap-1 mt-0.5">
        {sources.map((s, i) => (
          <div key={i} className="border-l-2 border-[#A100FF]/30 pl-1.5">
            {s.doc && (
              <span className="text-[9px] font-medium text-[#A100FF] uppercase tracking-wide block leading-tight">
                {s.doc}
              </span>
            )}
            {s.text && (
              <span className="text-[10px] text-[#6A6A6A] italic leading-snug block">
                {s.text.length > 180 ? s.text.slice(0, 180) + "…" : s.text}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Single source (plain string or single-entry array)
  const single = sources.length === 1
    ? (sources[0].doc && sources[0].text
        ? `${sources[0].doc} — ${sources[0].text}`
        : sources[0].doc || sources[0].text || "")
    : sourceCitation || raw;

  if (!single) return null;

  // Split "filename — paragraph" to display doc name distinctly
  const dashIdx = single.indexOf(" — ");
  const docName = dashIdx > -1 ? single.slice(0, dashIdx) : null;
  const paraText = dashIdx > -1 ? single.slice(dashIdx + 3) : single;

  return (
    <div className="border-l-2 border-[#E0E0E0] pl-1.5 mt-0.5">
      {docName && (
        <span className="text-[9px] font-medium text-[#A100FF] uppercase tracking-wide block leading-tight">
          {docName}
        </span>
      )}
      <span className="text-[10px] text-[#6A6A6A] italic leading-snug block">
        {paraText.length > 180 ? paraText.slice(0, 180) + "…" : paraText}
      </span>
    </div>
  );
}

export default function FichesPage() {
  const queryClient = useQueryClient();

  const [selectedProduct, setSelectedProduct] = useState<number | undefined>();
  const [selectedCrDocs, setSelectedCrDocs] = useState<number[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>();
  const [selectedRefVersion, setSelectedRefVersion] = useState<number | undefined>();
  const [activeTab, setActiveTab] = useState<string>("");
  const [filterConflict, setFilterConflict] = useState(false);
  const [filterConfidenceMax, setFilterConfidenceMax] = useState<number | undefined>();

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.list().then((r) => r.data),
  });

  const { data: docs = [] } = useQuery({
    queryKey: ["documents", selectedProduct],
    queryFn: () => documentsApi.list({ product_id: selectedProduct }).then((r) => r.data),
    enabled: !!selectedProduct,
  });

  const { data: templateCheck } = useQuery({
    queryKey: ["fiches-template-check"],
    queryFn: () => fichesApi.checkTemplate().then((r) => r.data),
  });

  const { data: versions = [] } = useQuery({
    queryKey: ["fiche-versions", selectedProduct],
    queryFn: () => fichesApi.versions(selectedProduct!).then((r) => r.data),
    enabled: !!selectedProduct,
  });

  const { data: refVersions = [] } = useQuery<ReferentielVersion[]>({
    queryKey: ["referentiel-versions", selectedProduct],
    queryFn: () => referentielApi.versions(selectedProduct!).then((r) => r.data),
    enabled: !!selectedProduct,
  });

  const refVersionObj = selectedRefVersion != null
    ? refVersions.find((v) => v.version === selectedRefVersion)
    : refVersions[0];
  const refVersionDocIds: number[] = refVersionObj?.document_ids ?? [];
  const refVersionDocs = docs.filter((d) => refVersionDocIds.includes(d.id));
  const complementaryAvailableDocs = docs.filter((d) => !refVersionDocIds.includes(d.id));

  const { data: allItems = [], isLoading: allLoading } = useQuery({
    queryKey: ["fiches", selectedProduct, selectedVersion],
    queryFn: () => fichesApi.list(selectedProduct!, { version: selectedVersion }).then((r) => r.data),
    enabled: !!selectedProduct,
  });

  const isFppTab = SHEETS.includes(activeTab);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["fiches-filtered", selectedProduct, activeTab, filterConflict, filterConfidenceMax, selectedVersion],
    queryFn: () =>
      fichesApi.list(selectedProduct!, {
        sheet: activeTab || undefined,
        conflict: filterConflict || undefined,
        confidence_max: filterConfidenceMax,
        version: selectedVersion,
      }).then((r) => r.data),
    enabled: !!selectedProduct && isFppTab,
  });

  const { data: ecarts = [] } = useQuery<EcartItem[]>({
    queryKey: ["fiches-ecarts", selectedProduct, selectedVersion],
    queryFn: () => fichesApi.ecarts(selectedProduct!, selectedVersion).then((r) => r.data),
    enabled: !!selectedProduct && activeTab === "ECARTS",
  });

  const { data: readingReports = [] } = useQuery<DocReadingReport[]>({
    queryKey: ["fiches-reading-report", selectedProduct, selectedVersion],
    queryFn: () => fichesApi.readingReport(selectedProduct!).then((r) => r.data),
    enabled: !!selectedProduct && activeTab === "RAPPORT",
  });

  useEffect(() => {
    if (allItems.length > 0 && !activeTab) {
      setActiveTab(SHEETS[0]);
    }
  }, [allItems, activeTab]);

  // Écarts count for badge
  const { data: ecartsBadge = [] } = useQuery<EcartItem[]>({
    queryKey: ["fiches-ecarts-badge", selectedProduct, selectedVersion],
    queryFn: () => fichesApi.ecarts(selectedProduct!, selectedVersion).then((r) => r.data),
    enabled: !!selectedProduct && allItems.length > 0,
  });

  const generateMutation = useMutation({
    mutationFn: () => fichesApi.generate(selectedProduct!, selectedCrDocs, selectedRefVersion),
    onSuccess: () => {
      setSelectedVersion(undefined);
      setActiveTab(SHEETS[0]);
      queryClient.invalidateQueries({ queryKey: ["fiches"] });
      queryClient.invalidateQueries({ queryKey: ["fiches-filtered"] });
      queryClient.invalidateQueries({ queryKey: ["fiche-versions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const deleteVersionMutation = useMutation({
    mutationFn: (versionNumber: number) => fichesApi.deleteVersion(selectedProduct!, versionNumber),
    onSuccess: () => {
      setSelectedVersion(undefined);
      setActiveTab("");
      queryClient.invalidateQueries({ queryKey: ["fiches"] });
      queryClient.invalidateQueries({ queryKey: ["fiches-filtered"] });
      queryClient.invalidateQueries({ queryKey: ["fiche-versions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const generateResult = generateMutation.isSuccess
    ? (generateMutation.data?.data as { count?: number; conflict_count?: number } | undefined)
    : undefined;

  const docColorMap = useMemo<Record<number, DocColor>>(() => {
    const sorted = [...docs].sort((a, b) => a.id - b.id);
    const map: Record<number, DocColor> = {};
    sorted.forEach((doc, idx) => { map[doc.id] = DOC_COLORS[idx % DOC_COLORS.length]; });
    return map;
  }, [docs]);

  function getSourceBadges(item: FicheItem): JSX.Element[] {
    let docIds: number[] = [];
    if (item.source_document_ids) {
      try { docIds = JSON.parse(item.source_document_ids); }
      catch { docIds = item.source_document_id != null ? [item.source_document_id] : []; }
    } else if (item.source_document_id != null) {
      docIds = [item.source_document_id];
    }
    return docIds.map((docId) => {
      const doc = docs.find((d) => d.id === docId);
      const color = docColorMap[docId];
      if (!doc || !color) return <span key={docId} />;
      const label = doc.original_filename.length > 30 ? doc.original_filename.slice(0, 27) + "..." : doc.original_filename;
      return (
        <span key={docId} className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium ${color.bg} ${color.text} mr-1 mb-0.5`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color.dot}`} />
          {label}
        </span>
      );
    });
  }

  const tabItems = items;
  const filled = tabItems.filter((i) => i.value && i.value !== NO_VALUE_DISPLAY).length;
  const conflicts = tabItems.filter((i) => i.conflict).length;
  const notDocumented = tabItems.filter((i) => !i.value || i.value === NO_VALUE_DISPLAY).length;

  const sectionGroups: Record<string, FicheItem[]> = {};
  tabItems.forEach((item) => {
    const sec = item.section || "Général";
    sectionGroups[sec] = sectionGroups[sec] || [];
    sectionGroups[sec].push(item);
  });

  const hasFilters = filterConflict || filterConfidenceMax !== undefined;
  const displayedFicheVersion = selectedVersion ?? versions[0]?.version;

  return (
    <div>
      <Header
        title="Fiches Produit KELIA"
        subtitle="Consultez et générez les fiches produit de vos contrats."
      />

      {/* Template banner */}
      <div className={`px-4 py-3 mb-6 flex items-center gap-3 text-sm border ${
        templateCheck?.exists
          ? "bg-green-50 border-green-200"
          : "bg-red-50 border-red-200"
      }`}>
        {templateCheck?.exists ? (
          <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-[#FF3333] flex-shrink-0" />
        )}
        <span className={templateCheck?.exists ? "text-green-800" : "text-[#FF3333]"}>
          {templateCheck?.exists
            ? `Modèle détecté : ${templateCheck.filename} — OK`
            : `Modèle introuvable : FPP_KELIA_Template_Model.xlsx — Vérifiez ${templateCheck?.path || "le répertoire generique"}`}
        </span>
      </div>

      {/* Controls card */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Product selector */}
          <div>
            <label className="block text-sm font-medium text-black mb-1">Produit BOSS</label>
            <select
              value={selectedProduct ?? ""}
              onChange={(e) => {
                setSelectedProduct(e.target.value ? Number(e.target.value) : undefined);
                setSelectedCrDocs([]);
                setSelectedVersion(undefined);
                setSelectedRefVersion(undefined);
                setActiveTab("");
              }}
              className="w-full border border-[#E0E0E0] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#A100FF]"
              style={{ borderRadius: 0 }}
            >
              <option value="">— Sélectionner un produit —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  BOSS {p.boss_number}{p.name ? ` — ${p.name}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Documents hérités + complémentaire */}
          {selectedProduct && (
            <div>
              <label className="block text-sm font-medium text-black mb-1">
                Documents sources
                {refVersionObj && <span className="font-normal text-[#6A6A6A] ml-1">({refVersionObj.label})</span>}
              </label>
              <div className="border border-[#E0E0E0] divide-y divide-[#F2F2F2] max-h-24 overflow-y-auto mb-2">
                {refVersionDocs.length === 0 ? (
                  <p className="text-xs text-[#6A6A6A] px-3 py-2 italic">
                    {refVersions.length === 0 ? "Générez d'abord un référentiel" : "Sélectionnez une version du référentiel"}
                  </p>
                ) : (
                  refVersionDocs.map((doc) => {
                    const color = docColorMap[doc.id];
                    return (
                      <div key={doc.id} className="flex items-center gap-2 px-3 py-1.5 bg-[#F3E0FF]">
                        {color && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color.dot}`} />}
                        <span className="text-xs text-black truncate flex-1">{doc.original_filename}</span>
                        <span className="text-xs text-[#A100FF] flex-shrink-0">hérité</span>
                      </div>
                    );
                  })
                )}
              </div>

              <label className="block text-xs font-medium text-[#6A6A6A] mb-1">
                Document complémentaire <span className="font-normal">(optionnel — prime sur le référentiel)</span>
              </label>
              <div className="border border-[#E0E0E0] divide-y divide-[#F2F2F2] max-h-24 overflow-y-auto">
                {complementaryAvailableDocs.length === 0 ? (
                  <p className="text-xs text-[#6A6A6A] px-3 py-2 italic">Tous les documents sont déjà dans le référentiel</p>
                ) : (
                  complementaryAvailableDocs.map((doc) => {
                    const color = docColorMap[doc.id];
                    return (
                      <label key={doc.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#F2F2F2]">
                        <input
                          type="checkbox"
                          checked={selectedCrDocs.includes(doc.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedCrDocs((prev) => [...prev, doc.id]);
                            else setSelectedCrDocs((prev) => prev.filter((id) => id !== doc.id));
                          }}
                          className="border-[#E0E0E0]"
                        />
                        {color && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color.dot}`} />}
                        <span className="text-xs text-black truncate flex-1">{doc.original_filename}</span>
                        {doc.category && <span className="text-xs text-[#6A6A6A] flex-shrink-0">{doc.category}</span>}
                      </label>
                    );
                  })
                )}
              </div>
              {selectedCrDocs.length > 0 && (
                <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  {selectedCrDocs.length} doc complémentaire — prime sur le référentiel
                </p>
              )}
            </div>
          )}

          {/* Referentiel version */}
          {selectedProduct && (
            <div>
              <label className="block text-sm font-medium text-black mb-1 flex items-center gap-1">
                <History className="w-3.5 h-3.5 text-[#6A6A6A]" /> Référentiel source
              </label>
              {refVersions.length === 0 ? (
                <p className="text-xs text-[#6A6A6A] mt-2">Aucun référentiel généré</p>
              ) : (
                <select
                  value={selectedRefVersion ?? ""}
                  onChange={(e) => setSelectedRefVersion(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full border border-[#E0E0E0] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#A100FF]"
                  style={{ borderRadius: 0 }}
                >
                  <option value="">
                    Dernière version ({refVersions[0]?.label} — {refVersions[0]?.item_count ?? "?"} règles)
                  </option>
                  {refVersions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.label} — {v.created_at ? new Date(v.created_at).toLocaleDateString("fr-FR") : ""} — {v.item_count} règle{v.item_count !== 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Actions + fiche version */}
          {selectedProduct && (
            <div className="flex flex-col justify-end gap-2">
              {versions.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-black mb-1 flex items-center gap-1">
                    <History className="w-3.5 h-3.5 text-[#6A6A6A]" /> Historique
                  </label>
                  <div className="flex gap-1">
                    <select
                      value={selectedVersion ?? ""}
                      onChange={(e) => setSelectedVersion(e.target.value ? Number(e.target.value) : undefined)}
                      className="flex-1 border border-[#E0E0E0] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#A100FF]"
                      style={{ borderRadius: 0 }}
                    >
                      <option value="">
                        Dernière ({versions[0]?.label} — {versions[0]?.item_count ?? "?"} champs)
                      </option>
                      {versions.map((v) => (
                        <option key={v.version} value={v.version}>
                          {v.label} — {v.created_at ? new Date(v.created_at).toLocaleDateString("fr-FR") : ""} — {v.item_count} champ{v.item_count !== 1 ? "s" : ""}
                        </option>
                      ))}
                    </select>
                    {displayedFicheVersion != null && (
                      <button
                        onClick={() => {
                          if (confirm(`Supprimer la fiche V${displayedFicheVersion} ? Cette action est irréversible.`)) {
                            deleteVersionMutation.mutate(displayedFicheVersion);
                          }
                        }}
                        disabled={deleteVersionMutation.isPending}
                        className="px-2 py-2 border border-[#E0E0E0] text-[#6A6A6A] hover:text-[#FF3333] hover:border-[#FF3333] transition-colors"
                        title={`Supprimer V${displayedFicheVersion}`}
                        style={{ borderRadius: 0 }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Traceability block */}
              {allItems.length > 0 && (() => {
                const viewedVer = selectedVersion != null ? versions.find((v) => v.version === selectedVersion) : versions[0];
                if (!viewedVer) return null;
                const viewedDocs = docs.filter((d) => (viewedVer.document_ids ?? []).includes(d.id));
                const compDocs = docs.filter((d) => (viewedVer.complementary_document_ids ?? []).includes(d.id));
                return (
                  <div className="text-xs text-[#6A6A6A] border border-[#E0E0E0] p-2 bg-[#F2F2F2]">
                    <span className="font-medium text-black">{viewedVer.label}</span>
                    {viewedVer.referentiel_version && <> · Réf. V{viewedVer.referentiel_version}</>}
                    {viewedDocs.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {viewedDocs.map((d) => {
                          const color = docColorMap[d.id];
                          return (
                            <span key={d.id} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs ${color?.bg ?? "bg-[#F2F2F2]"} ${color?.text ?? "text-black"}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${color?.dot ?? "bg-[#6A6A6A]"}`} />
                              {d.original_filename.length > 20 ? d.original_filename.slice(0, 18) + "…" : d.original_filename}
                              {compDocs.some((cd) => cd.id === d.id) && <span className="ml-0.5 font-bold text-[#A100FF]">+</span>}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || !selectedProduct || !templateCheck?.exists}
                className="btn-primary flex items-center gap-2 justify-center"
              >
                <Wand2 className="w-4 h-4" />
                {generateMutation.isPending
                  ? "Génération IA en cours..."
                  : versions.length > 0 ? "Nouvelle version" : "Générer la fiche produit"}
              </button>

              {allItems.length > 0 && (
                <a
                  href={fichesApi.exportExcel(selectedProduct)}
                  download
                  className="btn-secondary flex items-center gap-2 justify-center text-sm"
                >
                  <Download className="w-4 h-4" />
                  Exporter Excel
                </a>
              )}
            </div>
          )}
        </div>

        {generateMutation.isSuccess && (
          <p className="text-sm text-green-700 mt-3">
            {generateResult?.count ?? "?"} champs générés — {generateResult?.conflict_count ?? 0} incohérence(s)
          </p>
        )}
        {generateMutation.isError && (
          <p className="text-sm text-[#FF3333] mt-3 font-medium">
            ⚠{" "}
            {(generateMutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
              ?? "Erreur lors de la génération — vérifiez les logs du backend"}
          </p>
        )}
        {deleteVersionMutation.isError && (
          <p className="text-sm text-[#FF3333] mt-2">Erreur lors de la suppression de la version.</p>
        )}
      </div>

      {/* Sheet tabs + Écarts + Rapport de lecture */}
      {allItems.length > 0 && (
        <div className="flex gap-0 border-b border-[#E0E0E0] mb-4 overflow-x-auto">
          {SHEETS.map((sheet) => {
            const count = allItems.filter((i) => i.sheet === sheet).length;
            return (
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
                {count > 0 && (
                  <span className={`ml-1 text-xs px-1 ${activeTab === sheet ? "bg-[#F3E0FF] text-[#A100FF]" : "bg-[#F2F2F2] text-[#6A6A6A]"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}

          {/* Séparateur */}
          <div className="flex-shrink-0 w-px bg-[#E0E0E0] mx-2 self-stretch" />

          {/* Onglet Écarts */}
          <button
            onClick={() => setActiveTab("ECARTS")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === "ECARTS"
                ? "border-amber-500 text-amber-700"
                : "border-transparent text-[#6A6A6A] hover:text-black"
            }`}
          >
            <FileSearch className="w-3.5 h-3.5" />
            Écarts
            {ecartsBadge.length > 0 && (
              <span className={`text-xs px-1 font-medium ${activeTab === "ECARTS" ? "bg-amber-100 text-amber-700" : "bg-amber-50 text-amber-600"}`}>
                {ecartsBadge.length}
              </span>
            )}
          </button>

          {/* Onglet Rapport de lecture */}
          <button
            onClick={() => setActiveTab("RAPPORT")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === "RAPPORT"
                ? "border-blue-500 text-blue-700"
                : "border-transparent text-[#6A6A6A] hover:text-black"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Rapport de lecture
          </button>
        </div>
      )}


      {/* Filters bar */}
      {selectedProduct && allItems.length > 0 && activeTab && (
        <div className="card mb-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Filter className="w-4 h-4 text-[#6A6A6A] flex-shrink-0" />
            <select
              value={filterConflict ? "oui" : ""}
              onChange={(e) => setFilterConflict(e.target.value === "oui")}
              className={`text-sm border px-3 py-1.5 focus:outline-none ${
                filterConflict ? "border-[#FF3333] bg-red-50 text-[#FF3333]" : "border-[#E0E0E0] bg-white"
              }`}
              style={{ borderRadius: 0 }}
            >
              <option value="">Incohérences : toutes</option>
              <option value="oui">⚠ Incohérences uniquement</option>
            </select>
            <select
              value={filterConfidenceMax ?? ""}
              onChange={(e) => setFilterConfidenceMax(e.target.value ? Number(e.target.value) : undefined)}
              className={`text-sm border px-3 py-1.5 focus:outline-none ${
                filterConfidenceMax !== undefined ? "border-amber-400 bg-amber-50 text-amber-700" : "border-[#E0E0E0] bg-white"
              }`}
              style={{ borderRadius: 0 }}
            >
              <option value="">Confiance : tous</option>
              <option value="1.0">Confiance &lt; 100 %</option>
              <option value="0.9">Confiance &lt; 90 %</option>
              <option value="0.8">Confiance &lt; 80 %</option>
              <option value="0.7">Confiance &lt; 70 %</option>
              <option value="0.5">Confiance &lt; 50 %</option>
            </select>
            {hasFilters && (
              <button
                onClick={() => { setFilterConflict(false); setFilterConfidenceMax(undefined); }}
                className="text-xs text-[#6A6A6A] hover:text-black underline"
              >
                Réinitialiser
              </button>
            )}
            <span className="ml-auto text-xs text-[#6A6A6A]">
              {tabItems.length} champ{tabItems.length !== 1 ? "s" : ""}
              {conflicts > 0 && <span className="text-[#FF3333] font-medium ml-1">— {conflicts} incohérence{conflicts !== 1 ? "s" : ""}</span>}
            </span>
          </div>
        </div>
      )}

      {/* Results table by section */}
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
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Paramètre KELIA</th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Valeur</th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A] max-w-xs">Valeurs possibles</th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Source</th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Confiance</th>
                      <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F2F2]">
                    {sectionItems.map((item) => {
                      const isNoValue = item.value === NO_VALUE_DISPLAY;
                      const badges = getSourceBadges(item);
                      return (
                        <tr
                          key={item.id}
                          className={
                            item.conflict ? "bg-red-50" : isNoValue ? "bg-[#F2F2F2] opacity-70" : "hover:bg-[#F2F2F2]"
                          }
                        >
                          <td className="px-3 py-2 font-medium text-black">{item.parameter}</td>
                          <td className="px-3 py-2 max-w-xs">
                            {isNoValue ? (
                              <span className="text-xs text-[#6A6A6A] italic">Aucune règle mentionnée...</span>
                            ) : (
                              <div className="flex flex-col gap-1">
                                <span className="text-black">{item.value}</span>
                                <SourceCitations sourceParagraph={item.source_paragraph} sourceCitation={item.source_citation} />
                                {item.ai_comment && (item.ai_confidence ?? 1) < 0.65 && (
                                  <span className="text-[10px] text-[#6A6A6A] italic leading-tight">
                                    {item.ai_comment}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-[#6A6A6A] max-w-xs truncate" title={item.valeurs_possibles ?? undefined}>
                            {item.valeurs_possibles
                              ? item.valeurs_possibles.length > 60 ? item.valeurs_possibles.slice(0, 60) + "..." : item.valeurs_possibles
                              : ""}
                          </td>
                          <td className="px-3 py-2">
                            {badges.length > 0 ? (
                              <div className="flex flex-wrap">{badges}</div>
                            ) : item.source_paragraph ? (
                              <span className="text-xs text-[#6A6A6A] italic">{item.source_paragraph}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2"><ConfidenceBar value={item.ai_confidence} /></td>
                          <td className="px-3 py-2">
                            {item.cr_override ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-amber-100 text-amber-800 font-medium">
                                <AlertTriangle className="w-3 h-3" />CR Atelier
                              </span>
                            ) : item.conflict ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-red-50 text-[#FF3333]">
                                <AlertTriangle className="w-3 h-3" />À vérifier
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* CR Atelier overrides summary */}
          {tabItems.some((i) => i.cr_override) && (
            <div className="card mb-4 border-amber-200 bg-amber-50">
              <h3 className="font-semibold text-amber-900 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Remplacements CR Atelier — {tabItems.filter((i) => i.cr_override).length} champ{tabItems.filter((i) => i.cr_override).length !== 1 ? "s" : ""} remplacé{tabItems.filter((i) => i.cr_override).length !== 1 ? "s" : ""}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-amber-200">
                      <th className="text-left px-3 py-2 font-medium text-amber-800">Paramètre</th>
                      <th className="text-left px-3 py-2 font-medium text-amber-800">Valeur CR (appliquée)</th>
                      <th className="text-left px-3 py-2 font-medium text-amber-800">Source CR</th>
                      <th className="text-left px-3 py-2 font-medium text-amber-800">Détail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {tabItems.filter((i) => i.cr_override).map((item) => (
                      <tr key={item.id} className="hover:bg-amber-100">
                        <td className="px-3 py-2 font-medium text-black">{item.parameter}</td>
                        <td className="px-3 py-2 text-black">{item.value}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {getSourceBadges(item)}
                            {item.source_paragraph && !getSourceBadges(item).length && (
                              <span className="text-xs text-[#6A6A6A] italic">{item.source_paragraph}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-amber-700 max-w-xs">
                          {item.ai_comment || "Valeur CR appliquée (priorité sur le référentiel)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── ONGLET ÉCARTS ──────────────────────────────────────────────────── */}
      {activeTab === "ECARTS" && selectedProduct && (
        <div className="card mb-4">
          <div className="flex items-center gap-2 mb-4">
            <FileSearch className="w-5 h-5 text-amber-600" />
            <h2 className="font-semibold text-black">
              Informations détectées — absentes du modèle FPP cible
            </h2>
            {ecarts.length > 0 && (
              <span className="ml-auto text-xs font-medium px-2 py-0.5 bg-amber-100 text-amber-700">
                {ecarts.length} écart{ecarts.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-xs text-[#6A6A6A] mb-4">
            Ces règles et paramètres ont été détectés dans les documents sources mais ne correspondent à aucun champ du modèle FPP.
            Information non tracée = 0 est l'objectif.
          </p>
          {ecarts.length === 0 ? (
            <div className="text-center py-8 text-[#6A6A6A] text-sm">
              <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
              <p className="font-medium">Aucun écart — toutes les règles détectées sont mappées dans la FPP.</p>
              <p className="text-xs mt-1 text-[#6A6A6A]">Générez une fiche pour calculer les écarts.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E0E0E0] bg-amber-50">
                    <th className="text-left px-3 py-2 font-medium text-amber-800">Information détectée</th>
                    <th className="text-left px-3 py-2 font-medium text-amber-800">Valeur</th>
                    <th className="text-left px-3 py-2 font-medium text-amber-800">Domaine</th>
                    <th className="text-left px-3 py-2 font-medium text-amber-800">Document source</th>
                    <th className="text-left px-3 py-2 font-medium text-amber-800">Localisation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2F2F2]">
                  {ecarts.map((e) => (
                    <tr key={e.id} className="hover:bg-amber-50">
                      <td className="px-3 py-2 font-medium text-black max-w-xs">
                        <div className="flex flex-col gap-0.5">
                          <span>{e.rule_name}</span>
                          {e.source_paragraph && (
                            <span className="text-[10px] text-[#6A6A6A] italic line-clamp-2 leading-tight">
                              {e.source_paragraph.slice(0, 120)}{e.source_paragraph.length > 120 ? "…" : ""}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-black max-w-xs">
                        {e.rule_value && e.rule_value.length > 100
                          ? e.rule_value.slice(0, 100) + "…"
                          : e.rule_value || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-[#6A6A6A]">{e.category || "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {e.source_document_name ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 text-xs">
                            {e.source_document_name.length > 30
                              ? e.source_document_name.slice(0, 28) + "…"
                              : e.source_document_name}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-[#6A6A6A]">
                        {e.source_page ? `p.${e.source_page}` : ""}
                        {e.source_section ? (e.source_page ? ` · ${e.source_section}` : e.source_section) : ""}
                        {!e.source_page && !e.source_section ? "—" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── ONGLET RAPPORT DE LECTURE ──────────────────────────────────────── */}
      {activeTab === "RAPPORT" && selectedProduct && (
        <div className="card mb-4">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-black">Rapport de lecture documentaire</h2>
            {readingReports.length > 0 && (
              <span className="ml-auto text-xs font-medium px-2 py-0.5 bg-blue-50 text-blue-700">
                {readingReports.length} document{readingReports.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-xs text-[#6A6A6A] mb-4">
            Statistiques de lecture par document : pages, sections, tableaux, tokens analysés, items extraits.
            Généré lors de la création du référentiel.
          </p>
          {readingReports.length === 0 ? (
            <div className="text-center py-8 text-[#6A6A6A] text-sm">
              <BookOpen className="w-8 h-8 text-blue-300 mx-auto mb-2" />
              <p>Aucun rapport de lecture disponible.</p>
              <p className="text-xs mt-1">Régénérez le référentiel pour obtenir le rapport.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E0E0E0] bg-blue-50">
                    <th className="text-left px-3 py-2 font-medium text-blue-800">Document</th>
                    <th className="text-center px-3 py-2 font-medium text-blue-800">Type</th>
                    <th className="text-center px-3 py-2 font-medium text-blue-800">Pages</th>
                    <th className="text-center px-3 py-2 font-medium text-blue-800">Sections</th>
                    <th className="text-center px-3 py-2 font-medium text-blue-800">Tableaux</th>
                    <th className="text-center px-3 py-2 font-medium text-blue-800">Chars</th>
                    <th className="text-center px-3 py-2 font-medium text-blue-800">Chunks</th>
                    <th className="text-center px-3 py-2 font-medium text-blue-800">Tokens~</th>
                    <th className="text-center px-3 py-2 font-medium text-blue-800">Items extraits</th>
                    <th className="text-center px-3 py-2 font-medium text-blue-800">% lu</th>
                    <th className="text-center px-3 py-2 font-medium text-blue-800">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2F2F2]">
                  {readingReports.map((r) => (
                    <tr key={r.id} className={r.status === "NOT_READ" || r.status === "ERROR" ? "bg-red-50" : "hover:bg-blue-50"}>
                      <td className="px-3 py-2 font-medium text-black max-w-xs truncate" title={r.document_name}>
                        {r.document_name.length > 35 ? r.document_name.slice(0, 33) + "…" : r.document_name}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="text-xs px-1.5 py-0.5 bg-[#F2F2F2] text-[#6A6A6A] font-mono">{r.document_type}</span>
                      </td>
                      <td className="px-3 py-2 text-center text-[#6A6A6A]">{r.page_count ?? "—"}</td>
                      <td className="px-3 py-2 text-center text-[#6A6A6A]">{r.section_count ?? "—"}</td>
                      <td className="px-3 py-2 text-center text-[#6A6A6A]">{r.table_count ?? "—"}</td>
                      <td className="px-3 py-2 text-center text-[#6A6A6A] text-xs">{r.char_count != null ? r.char_count.toLocaleString("fr-FR") : "—"}</td>
                      <td className="px-3 py-2 text-center text-[#6A6A6A]">{r.chunk_count ?? "—"}</td>
                      <td className="px-3 py-2 text-center text-[#6A6A6A] text-xs">{r.token_estimate != null ? `~${r.token_estimate.toLocaleString("fr-FR")}` : "—"}</td>
                      <td className="px-3 py-2 text-center font-medium text-[#A100FF]">{r.items_extracted ?? "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <div className="w-16 h-1.5 bg-[#E0E0E0] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${r.pct_read ?? 0}%` }}
                            />
                          </div>
                          <span className="text-xs text-[#6A6A6A]">{r.pct_read != null ? `${r.pct_read}%` : "—"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.status === "READ_COMPLETE" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-700">
                            <CheckCircle className="w-3 h-3" /> OK
                          </span>
                        ) : r.status === "NOT_READ" ? (
                          <span className="text-xs text-[#FF3333]">Non lu</span>
                        ) : r.status === "ERROR" ? (
                          <span className="text-xs text-[#FF3333] flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Erreur
                          </span>
                        ) : (
                          <span className="text-xs text-[#6A6A6A]">{r.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Total bar */}
              <div className="mt-3 pt-3 border-t border-[#E0E0E0] flex flex-wrap gap-4 text-xs text-[#6A6A6A]">
                <span>
                  Total chars analysés :{" "}
                  <strong className="text-black">
                    {readingReports.reduce((s, r) => s + (r.char_count ?? 0), 0).toLocaleString("fr-FR")}
                  </strong>
                </span>
                <span>
                  Total items extraits :{" "}
                  <strong className="text-[#A100FF]">
                    {readingReports.reduce((s, r) => s + (r.items_extracted ?? 0), 0)}
                  </strong>
                </span>
                <span>
                  Documents lus intégralement :{" "}
                  <strong className="text-green-700">
                    {readingReports.filter((r) => r.status === "READ_COMPLETE").length}/{readingReports.length}
                  </strong>
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {(isLoading || allLoading) && selectedProduct && (
        <div className="card text-center py-8 text-[#6A6A6A] text-sm">Chargement en cours...</div>
      )}

      {selectedProduct && !isLoading && !allLoading && allItems.length === 0 && (
        <div className="card text-center py-12 text-[#6A6A6A]">
          <p className="font-medium">Aucune fiche générée.</p>
          <p className="text-sm mt-1">Sélectionnez un produit avec un référentiel existant et lancez la génération.</p>
        </div>
      )}

      {!selectedProduct && (
        <div className="card text-center py-12 text-[#6A6A6A]">
          <p>Sélectionnez un produit pour commencer.</p>
        </div>
      )}
    </div>
  );
}
