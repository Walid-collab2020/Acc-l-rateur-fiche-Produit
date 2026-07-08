"use client";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Header } from "@/components/layout/Header";
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";
import { productsApi, referentielApi, documentsApi, ReferentielItem, ReferentielFilters, DocExtractionStat } from "@/lib/api";
import { Wand2, Download, Filter, AlertTriangle, History, Trash2, ChevronDown, ChevronRight, FileText, BookOpen, CheckCircle, XCircle } from "lucide-react";

// ─── Section ordering: du général au particulier ───────────────────────────

// 24 domaines Cartographe — du général au particulier
const SECTION_ORDER = [
  "Identification produit",           // 8.1
  "Durée et vie du contrat",          // 8.2
  "Assurés et souscription",          // 8.3
  "Cotisations et versements",        // 8.4
  "Dates de valeur",                  // 8.5
  "Frais et charges",                 // 8.6
  "Constitution des droits",          // 8.7
  "Participation aux bénéfices",      // 8.8 + 8.16
  "Garanties",                        // 8.9
  "Rachat et transfert",              // 8.10 + 8.18
  "Décès en constitution",            // 8.11
  "Liquidation et calcul de la rente",// 8.12 + 8.13 + 8.14
  "Options de rente",                 // 8.15
  "Revalorisation",                   // 8.17
  "Fiscalité",                        // 8.19
  "Obligations et information",       // 8.20 + 8.21
  "Inventaire actuariel",             // 8.22
  "Paramètres techniques",            // 8.23
  "Points d'attention SI / Migration",// 8.24
  "Écarts entre sources",
  "Points à vérifier",
  "Autres",
];

// Mapping raw category → section métier (24 domaines + catégories legacy)
function mapCategory(raw: string): string {
  const r = (raw || "").toLowerCase().trim();
  if (r.includes("identification") || r === "8.1" || r.startsWith("8.1 ")) return "Identification produit";
  if (r.includes("durée") || r.includes("résiliation") || r === "8.2" || r.startsWith("8.2 ") || r.includes("durée_résiliation")) return "Durée et vie du contrat";
  if (r.includes("assuré") || r.includes("souscription") || r.includes("affiliation") || r.includes("population") || r === "8.3" || r.startsWith("8.3 ")) return "Assurés et souscription";
  if (r.includes("cotisation") || r.includes("versement") || r === "8.4" || r.startsWith("8.4 ")) return "Cotisations et versements";
  if (r.includes("date") || r === "8.5" || r.startsWith("8.5 ")) return "Dates de valeur";
  if (r.includes("frais") || r === "8.6" || r.startsWith("8.6 ")) return "Frais et charges";
  if (r.includes("strate") || r.includes("constitution") || r === "8.7" || r.startsWith("8.7 ")) return "Constitution des droits";
  if (r.includes("pb") || r.includes("participation") || r.includes("bénéfice") || r.includes("fonds_collectif") || r === "8.8" || r.startsWith("8.8 ") || r === "8.16" || r.startsWith("8.16 ")) return "Participation aux bénéfices";
  if (r.includes("garantie") && !r.includes("décès") || r === "8.9" || r.startsWith("8.9 ")) return "Garanties";
  if (r.includes("rachat") || r.includes("transfert") || r === "8.10" || r.startsWith("8.10 ") || r === "8.18" || r.startsWith("8.18 ")) return "Rachat et transfert";
  if ((r.includes("décès") || r.includes("deces")) && (r.includes("constitution") || r.includes("accumulation") || r.includes("capital") || r === "8.11" || r.startsWith("8.11 "))) return "Décès en constitution";
  if (r.includes("garantie") && r.includes("décès")) return "Décès en constitution";
  if (r.includes("liquidation") || r.includes("calcul_rente") || r.includes("paiement") || r === "8.12" || r.startsWith("8.12 ") || r === "8.13" || r.startsWith("8.13 ") || r === "8.14" || r.startsWith("8.14 ")) return "Liquidation et calcul de la rente";
  if (r.includes("option") || r.includes("réversion") || r.includes("annuité") || r.includes("modulable") || r.includes("dépendance") || r === "8.15" || r.startsWith("8.15 ")) return "Options de rente";
  if (r.includes("revalorisation") || r === "8.17" || r.startsWith("8.17 ")) return "Revalorisation";
  if (r.includes("fiscal") || r.includes("taxe") || r.includes("tca") || r === "8.19" || r.startsWith("8.19 ")) return "Fiscalité";
  if (r.includes("obligation") || r.includes("information") || r.includes("prescription") || r.includes("défaut") || r === "8.20" || r.startsWith("8.20 ") || r === "8.21" || r.startsWith("8.21 ") || r.includes("défaut_paiement")) return "Obligations et information";
  if (r.includes("inventaire") || r.includes("actuariel") || r.includes("pm ") || r === "8.22" || r.startsWith("8.22 ")) return "Inventaire actuariel";
  if (r.includes("tables_mortalité") || r.includes("taux_technique") || r.includes("paramètre") || r === "8.23" || r.startsWith("8.23 ")) return "Paramètres techniques";
  if (r.includes("sip") || r.includes("points_attention") || r.includes("migration") || r.includes("contrainte") || r === "8.24" || r.startsWith("8.24 ")) return "Points d'attention SI / Migration";
  if (r.includes("écart") || r.includes("conflict")) return "Écarts entre sources";
  if (r.includes("vérifier") || r.includes("verifier") || r.includes("formule") || r.includes("à vérifier")) return "Points à vérifier";
  return "Autres";
}

// Clés d'identification produit pour la carte en haut
const ID_KEYS = [
  "assureur", "compagnie", "nom commercial", "libellé", "type de contrat",
  "régime fiscal", "branche", "n° des conditions", "conditions générales",
  "nature juridique", "objet du contrat", "article 83",
];

function isIdentityField(ruleName: string): boolean {
  const r = ruleName.toLowerCase();
  return ID_KEYS.some((k) => r.includes(k));
}

// ─── Couleurs documents ────────────────────────────────────────────────────

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

// ─── Page ──────────────────────────────────────────────────────────────────

export default function ReferentielPage() {
  const queryClient = useQueryClient();
  const [selectedProduct, setSelectedProduct] = useState<number | undefined>();
  const [selectedDocs, setSelectedDocs] = useState<number[]>([]);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterConflict, setFilterConflict] = useState(false);
  const [filterConfidenceMax, setFilterConfidenceMax] = useState<number | undefined>();
  const [filterSourceDocId, setFilterSourceDocId] = useState<number | undefined>();
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.list().then((r) => r.data),
  });
  const { data: docs = [] } = useQuery({
    queryKey: ["documents", selectedProduct],
    queryFn: () => documentsApi.list({ product_id: selectedProduct }).then((r) => r.data),
    enabled: !!selectedProduct,
  });
  const { data: versions = [] } = useQuery({
    queryKey: ["referentiel-versions", selectedProduct],
    queryFn: () => referentielApi.versions(selectedProduct!).then((r) => r.data),
    enabled: !!selectedProduct,
  });

  // filterCategory filtre côté client sur les noms de sections (pas sur les catégories brutes)
  const filters: ReferentielFilters = {
    ...(filterConflict ? { conflict: true } : {}),
    ...(filterConfidenceMax !== undefined ? { confidence_max: filterConfidenceMax } : {}),
    ...(filterSourceDocId !== undefined ? { source_doc_id: filterSourceDocId } : {}),
    ...(selectedVersion !== undefined ? { version: selectedVersion } : {}),
  };

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["referentiel", selectedProduct, filters],
    queryFn: () => referentielApi.list(selectedProduct!, filters).then((r) => r.data),
    enabled: !!selectedProduct,
  });

  const generateMutation = useMutation({
    mutationFn: () => {
      const docIds = selectedDocs.length > 0 ? selectedDocs : docs.map((d) => d.id);
      return referentielApi.generate(selectedProduct!, docIds);
    },
    onSuccess: () => {
      setSelectedVersion(undefined);
      queryClient.invalidateQueries({ queryKey: ["referentiel"] });
      queryClient.invalidateQueries({ queryKey: ["referentiel-versions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const deleteVersionMutation = useMutation({
    mutationFn: (versionNumber: number) => referentielApi.deleteVersion(selectedProduct!, versionNumber),
    onSuccess: () => {
      setSelectedVersion(undefined);
      queryClient.invalidateQueries({ queryKey: ["referentiel"] });
      queryClient.invalidateQueries({ queryKey: ["referentiel-versions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const currentVersionObj = useMemo(
    () => (selectedVersion != null ? versions.find((v) => v.version === selectedVersion) : versions[0]),
    [versions, selectedVersion]
  );
  const versionDocIds: number[] = useMemo(() => currentVersionObj?.document_ids ?? [], [currentVersionObj]);

  useEffect(() => {
    if (versionDocIds.length > 0) setSelectedDocs(versionDocIds);
  }, [versionDocIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const docColorMap = useMemo<Record<number, DocColor>>(() => {
    const sorted = [...docs].sort((a, b) => a.id - b.id);
    const map: Record<number, DocColor> = {};
    sorted.forEach((doc, idx) => { map[doc.id] = DOC_COLORS[idx % DOC_COLORS.length]; });
    return map;
  }, [docs]);

  function getSourceBadges(item: ReferentielItem): JSX.Element[] {
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
      const label = doc.original_filename.length > 28 ? doc.original_filename.slice(0, 25) + "..." : doc.original_filename;
      return (
        <span key={docId} className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium ${color.bg} ${color.text} mr-1 mb-0.5`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color.dot}`} />
          {label}
        </span>
      );
    });
  }

  // ── Groupement par section métier ordonnée ──────────────────────────────

  const sectionGroups = useMemo(() => {
    const map: Record<string, ReferentielItem[]> = {};
    items.forEach((item) => {
      // Écarts et points à vérifier dans sections dédiées
      if (item.conflict || (item.rule_name || "").includes("[ÉCART]")) {
        map["Écarts entre sources"] = map["Écarts entre sources"] || [];
        map["Écarts entre sources"].push(item);
        return;
      }
      if ((item.rule_value || "").trim().toUpperCase() === "A VERIFIER") {
        map["Points à vérifier"] = map["Points à vérifier"] || [];
        map["Points à vérifier"].push(item);
        return;
      }
      const section = mapCategory(item.category || "");
      map[section] = map[section] || [];
      map[section].push(item);
    });
    // Trier selon SECTION_ORDER
    const ordered: [string, ReferentielItem[]][] = [];
    SECTION_ORDER.forEach((s) => { if (map[s]) ordered.push([s, map[s]]); });
    // Sections hors liste à la fin
    Object.entries(map).forEach(([s, its]) => {
      if (!SECTION_ORDER.includes(s)) ordered.push([s, its]);
    });
    return ordered;
  }, [items]);

  // ── Carte d'identité produit ────────────────────────────────────────────

  const identityItems = useMemo(() =>
    items.filter((i) =>
      isIdentityField(i.rule_name || "") &&
      i.rule_value &&
      i.rule_value !== "Aucune règle mentionnée dans les documents analysés" &&
      (i.rule_value || "").trim().toUpperCase() !== "A VERIFIER"
    ).slice(0, 12),
    [items]
  );

  const conflictCount = items.filter((i) => i.conflict).length;
  const displayedVersion = selectedVersion ?? versions[0]?.version;

  // ── Couverture par document ─────────────────────────────────────────────
  type DocCoverage = {
    doc: (typeof docs)[0];
    color: DocColor;
    itemCount: number;
    pagesReferenced: number[];
    totalPages: number | undefined;
    coveragePct: number | undefined;
    hasPageData: boolean;
  };

  const docCoverages = useMemo<DocCoverage[]>(() => {
    const activeDocs = versionDocIds.length > 0
      ? docs.filter((d) => versionDocIds.includes(d.id))
      : docs;
    return activeDocs.map((doc) => {
      const docItems = items.filter((item) => {
        if (item.source_document_id === doc.id) return true;
        if (item.source_document_ids) {
          try { return (JSON.parse(item.source_document_ids) as number[]).includes(doc.id); }
          catch { return false; }
        }
        return false;
      });
      const pages = docItems
        .map((i) => i.source_page)
        .filter((p): p is number => p != null && p > 0);
      const uniquePages = Array.from(new Set(pages));
      const totalPages = doc.page_count;
      // 0% seulement si on a réellement des données de pages ET aucune page citée.
      // Si source_page est toujours null (hasPageData=false), la couverture est inconnue (undefined).
      const hasPageData = pages.length > 0;
      const coveragePct =
        hasPageData && totalPages && totalPages > 0
          ? Math.min(100, Math.round((uniquePages.length / totalPages) * 100))
          : undefined;
      return {
        doc,
        color: docColorMap[doc.id] ?? DOC_COLORS[0],
        itemCount: docItems.length,
        pagesReferenced: uniquePages.sort((a, b) => a - b),
        totalPages,
        coveragePct,
        hasPageData,
      };
    });
  }, [items, docs, versionDocIds, docColorMap]);
  const generateResult = generateMutation.isSuccess
    ? (generateMutation.data?.data as { count?: number; conflict_count?: number; sourced_count?: number; pct_sourced?: number } | undefined)
    : undefined;

  function toggleSection(section: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      next.has(section) ? next.delete(section) : next.add(section);
      return next;
    });
  }

  const NO_VALUE = "Aucune règle mentionnée dans les documents analysés";

  return (
    <div>
      <Header
        title="Référentiel Produit"
        subtitle="Cartographie exhaustive des règles de gestion — du général au particulier"
      />

      {/* Controls */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-black mb-1">Produit BOSS</label>
            <select
              value={selectedProduct ?? ""}
              onChange={(e) => { setSelectedProduct(e.target.value ? Number(e.target.value) : undefined); setSelectedDocs([]); }}
              className="w-full border border-[#E0E0E0] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#A100FF]"
              style={{ borderRadius: 0 }}
            >
              <option value="">— Sélectionner un produit —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>BOSS {p.boss_number}{p.name ? ` — ${p.name}` : ""}</option>
              ))}
            </select>
          </div>

          {selectedProduct && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-black">Documents source</label>
                <button
                  type="button"
                  onClick={() => setSelectedDocs(selectedDocs.length === docs.length ? versionDocIds : docs.map((d) => d.id))}
                  className="text-xs text-[#A100FF] hover:underline"
                >
                  {selectedDocs.length === docs.length ? "Réinitialiser" : "Tout sélectionner"}
                </button>
              </div>
              <div className="border border-[#E0E0E0] divide-y divide-[#F2F2F2] max-h-40 overflow-y-auto">
                {docs.length === 0 && <p className="text-xs text-[#6A6A6A] px-3 py-2">Aucun document</p>}
                {docs.map((doc) => {
                  const color = docColorMap[doc.id];
                  const fromVersion = versionDocIds.includes(doc.id);
                  return (
                    <label key={doc.id} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#F2F2F2] ${fromVersion ? "bg-[#F3E0FF]" : ""}`}>
                      <input type="checkbox" checked={selectedDocs.includes(doc.id)}
                        onChange={(e) => setSelectedDocs((prev) => e.target.checked ? [...prev, doc.id] : prev.filter((id) => id !== doc.id))}
                        className="border-[#E0E0E0]" />
                      {color && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color.dot}`} />}
                      <span className="text-xs text-black truncate flex-1">{doc.original_filename}</span>
                      {fromVersion
                        ? <span className="text-xs text-[#A100FF] flex-shrink-0 font-medium">{currentVersionObj?.label}</span>
                        : <span className="text-xs text-green-600 flex-shrink-0">+nouveau</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

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
                      <option value="">Dernière ({versions[0]?.label} — {versions[0]?.item_count ?? "?"} règles)</option>
                      {versions.map((v) => (
                        <option key={v.version} value={v.version}>
                          {v.label} — {v.created_at ? new Date(v.created_at).toLocaleDateString("fr-FR") : ""} — {v.item_count} règles
                        </option>
                      ))}
                    </select>
                    {displayedVersion != null && (
                      <button
                        onClick={() => { if (confirm(`Supprimer V${displayedVersion} ?`)) deleteVersionMutation.mutate(displayedVersion); }}
                        disabled={deleteVersionMutation.isPending}
                        className="px-2 py-2 border border-[#E0E0E0] text-[#6A6A6A] hover:text-[#FF3333] hover:border-[#FF3333]"
                        style={{ borderRadius: 0 }}
                        title={`Supprimer V${displayedVersion}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || docs.length === 0}
                className="btn-primary flex items-center gap-2 justify-center"
              >
                <Wand2 className="w-4 h-4" />
                {generateMutation.isPending ? "Cartographie en cours…" : versions.length > 0 ? "Nouvelle version" : "Générer le référentiel"}
              </button>
              {items.length > 0 && (
                <a href={referentielApi.exportExcel(selectedProduct)} download
                  className="btn-secondary flex items-center gap-2 justify-center text-sm">
                  <Download className="w-4 h-4" /> Exporter Excel
                </a>
              )}
            </div>
          )}
        </div>

        {generateMutation.isSuccess && (
          <p className="text-sm text-green-700 mt-3">
            V{versions[0]?.version} — {generateResult?.count ?? "?"} règles extraites,{" "}
            {generateResult?.conflict_count ?? 0} écart(s),{" "}
            {generateResult?.pct_sourced !== undefined ? `${generateResult.pct_sourced}% sourcées` : ""}
          </p>
        )}
        {generateMutation.isError && (
          <p className="text-sm text-[#FF3333] mt-3 font-medium">
            ⚠ {(generateMutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Erreur — vérifiez les logs du backend"}
          </p>
        )}
      </div>

      {/* Légende documents */}
      {items.length > 0 && docs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 px-1">
          {docs.filter((d) => versionDocIds.length > 0 ? versionDocIds.includes(d.id) : docColorMap[d.id] !== undefined).map((doc) => {
            const color = docColorMap[doc.id];
            return (
              <span key={doc.id} className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium ${color.bg} ${color.text}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color.dot}`} />
                {doc.original_filename.length > 35 ? doc.original_filename.slice(0, 32) + "..." : doc.original_filename}
              </span>
            );
          })}
        </div>
      )}

      {/* Filtres */}
      {selectedProduct && items.length > 0 && (
        <div className="card mb-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Filter className="w-4 h-4 text-[#6A6A6A] flex-shrink-0" />
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
              className="text-sm border border-[#E0E0E0] px-3 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#A100FF]" style={{ borderRadius: 0 }}>
              <option value="">Toutes les sections</option>
              {SECTION_ORDER.filter((s) => sectionGroups.find(([k]) => k === s)).map((s) => {
                const count = sectionGroups.find(([k]) => k === s)?.[1].length ?? 0;
                return <option key={s} value={s}>{s} ({count})</option>;
              })}
            </select>
            <select value={filterConflict ? "oui" : ""} onChange={(e) => setFilterConflict(e.target.value === "oui")}
              className={`text-sm border px-3 py-1.5 focus:outline-none ${filterConflict ? "border-[#FF3333] bg-red-50 text-[#FF3333]" : "border-[#E0E0E0] bg-white"}`}
              style={{ borderRadius: 0 }}>
              <option value="">Écarts : tous</option>
              <option value="oui">⚠ Écarts uniquement</option>
            </select>
            <select value={filterConfidenceMax ?? ""} onChange={(e) => setFilterConfidenceMax(e.target.value ? Number(e.target.value) : undefined)}
              className={`text-sm border px-3 py-1.5 focus:outline-none ${filterConfidenceMax !== undefined ? "border-amber-400 bg-amber-50 text-amber-700" : "border-[#E0E0E0] bg-white"}`}
              style={{ borderRadius: 0 }}>
              <option value="">Confiance : tous</option>
              <option value="0.9">Confiance &lt; 90%</option>
              <option value="0.8">Confiance &lt; 80%</option>
              <option value="0.7">Confiance &lt; 70%</option>
              <option value="0.5">Confiance &lt; 50%</option>
            </select>
            {(versionDocIds.length > 0 ? docs.filter((d) => versionDocIds.includes(d.id)) : docs).length > 0 && (
              <select value={filterSourceDocId ?? ""} onChange={(e) => setFilterSourceDocId(e.target.value ? Number(e.target.value) : undefined)}
                className={`text-sm border px-3 py-1.5 focus:outline-none ${filterSourceDocId !== undefined ? "border-[#A100FF] bg-[#F3E0FF] text-[#7700CC]" : "border-[#E0E0E0] bg-white"}`}
                style={{ borderRadius: 0 }}>
                <option value="">Document : tous</option>
                {(versionDocIds.length > 0 ? docs.filter((d) => versionDocIds.includes(d.id)) : docs).map((d) => (
                  <option key={d.id} value={d.id}>{d.original_filename.length > 40 ? d.original_filename.slice(0, 37) + "..." : d.original_filename}</option>
                ))}
              </select>
            )}
            {(filterCategory || filterConflict || filterConfidenceMax !== undefined || filterSourceDocId !== undefined) && (
              <button onClick={() => { setFilterCategory(""); setFilterConflict(false); setFilterConfidenceMax(undefined); setFilterSourceDocId(undefined); }}
                className="text-xs text-[#6A6A6A] hover:text-black underline">Réinitialiser</button>
            )}
            <span className="ml-auto text-xs text-[#6A6A6A]">
              {items.length} règle{items.length !== 1 ? "s" : ""}
              {conflictCount > 0 && <span className="text-[#FF3333] font-medium ml-1">— {conflictCount} écart{conflictCount !== 1 ? "s" : ""}</span>}
            </span>
          </div>
        </div>
      )}

      {/* ── Tableau de bord qualité extraction ── */}
      {items.length > 0 && (
        <div className="card mb-5 border-l-4 border-[#6A6A6A]">
          <h3 className="text-sm font-semibold text-black mb-3 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#6A6A6A]" />
            Qualité &amp; couverture par document
            <span className="text-xs font-normal text-[#6A6A6A]">— exhaustivité de l'extraction</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#E0E0E0] bg-[#F2F2F2]">
                  <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Document</th>
                  <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Type</th>
                  <th className="text-right px-3 py-2 font-medium text-[#6A6A6A]">Pages/Feuilles</th>
                  <th className="text-right px-3 py-2 font-medium text-[#6A6A6A]">Règles brutes</th>
                  <th className="text-right px-3 py-2 font-medium text-[#6A6A6A]">Règles finales</th>
                  <th className="text-right px-3 py-2 font-medium text-[#6A6A6A]">Pages sourcées</th>
                  <th className="text-right px-3 py-2 font-medium text-[#6A6A6A]">Couverture pages</th>
                  <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Domaines vides</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F2F2]">
                {docCoverages.map(({ doc, color, itemCount, pagesReferenced, totalPages, coveragePct, hasPageData }) => {
                  const versionDocStats = currentVersionObj?.doc_stats;
                  const docStat: DocExtractionStat | undefined = versionDocStats
                    ? (versionDocStats[String(doc.id)] ?? Object.values(versionDocStats).find((s) => s.doc_name === doc.original_filename))
                    : undefined;
                  const emptyDomains = docStat?.categories_empty ?? [];
                  const pctSourced = docStat?.pct_sourced;
                  return (
                    <tr key={doc.id} className="hover:bg-[#F8F8F8]">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color.dot}`} />
                          <span className="font-medium text-black max-w-[180px] truncate" title={doc.original_filename}>
                            {doc.original_filename.length > 30 ? doc.original_filename.slice(0, 27) + "…" : doc.original_filename}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[#6A6A6A] uppercase tracking-wide">
                        {doc.mime_type?.includes("pdf") ? "PDF"
                          : doc.mime_type?.includes("word") ? "DOC"
                          : doc.mime_type?.includes("sheet") || doc.mime_type?.includes("excel") ? "XLS"
                          : doc.original_filename.split(".").pop()?.toUpperCase() ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-black font-medium">
                        {totalPages ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-black font-medium">
                        {docStat?.items_raw ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-black font-medium">
                        {itemCount}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {hasPageData ? (
                          <span className="text-black font-medium">{pagesReferenced.length}
                            {totalPages ? <span className="text-[#6A6A6A] font-normal"> / {totalPages}</span> : null}
                          </span>
                        ) : <span className="text-amber-500">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {coveragePct !== undefined ? (
                          <span className={`font-bold ${coveragePct >= 80 ? "text-emerald-700" : coveragePct >= 50 ? "text-amber-600" : "text-[#FF3333]"}`}>
                            {coveragePct}%
                          </span>
                        ) : pctSourced !== undefined ? (
                          <span className={`font-bold ${pctSourced >= 80 ? "text-emerald-700" : pctSourced >= 50 ? "text-amber-600" : "text-[#FF3333]"}`}>
                            {pctSourced}% sourcées
                          </span>
                        ) : <span className="text-amber-500 flex items-center justify-end gap-1"><AlertTriangle className="w-3 h-3" />?</span>}
                      </td>
                      <td className="px-3 py-2">
                        {emptyDomains.length === 0 ? (
                          <span className="flex items-center gap-1 text-emerald-700"><CheckCircle className="w-3 h-3" />tous couverts</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {emptyDomains.slice(0, 5).map((d) => (
                              <span key={d} className="px-1 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-xs">{d}</span>
                            ))}
                            {emptyDomains.length > 5 && (
                              <span className="text-amber-600">+{emptyDomains.length - 5} autres</span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[#6A6A6A] mt-2 italic">
            "Domaines vides" = catégories 8.x sans règle extraite pour ce document. Peut indiquer une zone non couverte ou absente du document.
          </p>
        </div>
      )}

      {/* ── Carte d'identité produit ── */}
      {identityItems.length > 0 && (
        <div className="card mb-5 border-l-4 border-[#A100FF]">
          <h2 className="text-base font-semibold text-black mb-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-[#A100FF] rounded-full" />
            Carte d'identité du produit
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
            {identityItems.map((item) => {
              const badges = getSourceBadges(item);
              return (
                <div key={item.id} className="flex flex-col py-1 border-b border-[#F2F2F2] last:border-0">
                  <span className="text-xs text-[#6A6A6A] font-medium">{item.rule_name}</span>
                  <span className="text-sm text-black font-semibold mt-0.5">{item.rule_value}</span>
                  {badges.length > 0 && <div className="flex flex-wrap mt-0.5">{badges}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Sections du général au particulier ── */}
      {selectedProduct && sectionGroups.length > 0 && (
        <>
          {sectionGroups
            .filter(([sectionName]) => !filterCategory || sectionName === filterCategory)
            .map(([sectionName, sectionItems]) => {
              const isCollapsed = collapsedSections.has(sectionName);
              const isEcart = sectionName === "Écarts entre sources";
              const isVerif = sectionName === "Points à vérifier";
              const headerBg = isEcart ? "border-l-4 border-[#FF3333]" : isVerif ? "border-l-4 border-amber-400" : "border-l-4 border-[#A100FF]";

              return (
                <div key={sectionName} className={`card mb-4 ${headerBg}`}>
                  <button
                    className="w-full flex items-center justify-between"
                    onClick={() => toggleSection(sectionName)}
                  >
                    <h3 className="font-semibold text-black flex items-center gap-2">
                      {isEcart && <AlertTriangle className="w-4 h-4 text-[#FF3333]" />}
                      {sectionName}
                      <span className="text-xs font-normal text-[#6A6A6A]">({sectionItems.length} règle{sectionItems.length !== 1 ? "s" : ""})</span>
                    </h3>
                    {isCollapsed
                      ? <ChevronRight className="w-4 h-4 text-[#6A6A6A]" />
                      : <ChevronDown className="w-4 h-4 text-[#6A6A6A]" />}
                  </button>

                  {!isCollapsed && (
                    <div className="overflow-x-auto mt-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[#E0E0E0] bg-[#F2F2F2]">
                            <th className="text-left px-3 py-2 font-medium text-[#6A6A6A] w-1/4">Règle</th>
                            <th className="text-left px-3 py-2 font-medium text-[#6A6A6A] w-2/5">Valeur</th>
                            <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Unité</th>
                            <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Emplacement</th>
                            <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Source(s)</th>
                            <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Confiance</th>
                            <th className="text-left px-3 py-2 font-medium text-[#6A6A6A]">Statut</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F2F2F2]">
                          {sectionItems.map((item) => {
                            const badges = getSourceBadges(item);
                            const isNoValue = item.rule_value === NO_VALUE;
                            return (
                              <tr key={item.id}
                                className={item.conflict ? "bg-red-50" : isNoValue ? "bg-[#F2F2F2] opacity-60" : "hover:bg-[#F2F2F2]"}>
                                <td className="px-3 py-2 font-medium text-black text-xs leading-snug">{item.rule_name}</td>
                                <td className="px-3 py-2 max-w-sm">
                                  {isNoValue
                                    ? <span className="text-xs text-[#6A6A6A] italic">Non mentionné</span>
                                    : <span className="text-black text-sm">{item.rule_value ?? ""}</span>}
                                  {item.rule_value === "A VERIFIER" && (
                                    <span className="ml-1 text-xs text-amber-600 font-medium">⚠ À vérifier</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-[#6A6A6A] text-xs">{item.rule_unit ?? ""}</td>
                                <td className="px-3 py-2 text-[#6A6A6A] text-xs whitespace-nowrap">
                                  {item.source_page != null && item.source_page > 0 && (
                                    <span className="inline-flex items-center gap-1 font-medium text-[#6A6A6A]">
                                      <FileText className="w-3 h-3" />p.{item.source_page}
                                    </span>
                                  )}
                                  {!item.source_page && item.source_paragraph && item.source_paragraph.startsWith("=== SECTION") && (
                                    <span className="text-[#6A6A6A] italic truncate max-w-[80px] block">
                                      {item.source_paragraph.replace(/=== SECTION : (.+) ===/,"$1").slice(0,30)}
                                    </span>
                                  )}
                                  {!item.source_page && (!item.source_paragraph || item.source_paragraph === "Source non identifiée") && (
                                    <span className="text-amber-500">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {badges.length > 0
                                    ? <div className="flex flex-wrap">{badges}</div>
                                    : item.source_paragraph
                                    ? <span className="text-xs text-[#6A6A6A] italic">{item.source_paragraph.slice(0, 60)}{item.source_paragraph.length > 60 ? "…" : ""}</span>
                                    : <span className="text-[#6A6A6A] text-xs">—</span>}
                                </td>
                                <td className="px-3 py-2"><ConfidenceBar value={item.ai_confidence} /></td>
                                <td className="px-3 py-2">
                                  {item.conflict && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-50 text-[#FF3333]">
                                      <AlertTriangle className="w-3 h-3" />Écart
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
        </>
      )}

      {selectedProduct && !isLoading && items.length === 0 && (
        <div className="card text-center py-12 text-[#6A6A6A]">
          <p>Aucune règle extraite. Sélectionnez des documents et lancez la génération.</p>
        </div>
      )}
      {isLoading && selectedProduct && (
        <div className="card text-center py-8 text-[#6A6A6A] text-sm">Chargement en cours…</div>
      )}

    </div>
  );
}
