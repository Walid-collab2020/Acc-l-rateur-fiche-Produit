import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  timeout: 60000,
});

// Long-running operations (LLM extraction + fiche generation) — pas de timeout axios
// Le navigateur maintient la connexion tant que le serveur répond
const apiLong = axios.create({
  baseURL: "/api",
  timeout: 0,
});

export default api;

// Types
export interface Product {
  id: number;
  boss_number: string;
  name?: string;
  description?: string;
  status_referentiel: string;
  status_fiche: string;
  status_parametrage: string;
  status_recette: string;
  document_count: number;
  created_at: string;
}

export interface Document {
  id: number;
  filename: string;
  original_filename: string;
  scope: string;
  category?: string;
  category_confirmed: boolean;
  ai_confidence?: number;
  ai_summary?: string;
  ai_classification_reason?: string;
  product_id?: number;
  file_size?: number;
  page_count?: number;
  mime_type?: string;
  created_at: string;
}

export interface ReferentielItem {
  id: number;
  category?: string;
  subcategory?: string;
  rule_name: string;
  rule_value?: string;
  rule_unit?: string;
  source_document_id?: number;
  source_page?: number;
  source_paragraph?: string;
  ai_confidence?: number;
  ai_comment?: string;
  version_number: number;
  source_document_ids?: string;
  conflict?: boolean;
}

export interface PortfolioKPIs {
  kpis: {
    total_products: number;
    products_validated_fiche: number;
    products_validated_parametrage: number;
    products_validated_recette: number;
    open_anomalies: number;
    taux_fiche: number;
    taux_parametrage: number;
    taux_recette: number;
  };
  products: Array<{
    id: number;
    boss_number: string;
    name?: string;
    document_count: number;
    rule_count: number;
    status_referentiel: string;
    status_fiche: string;
    status_parametrage: string;
    status_recette: string;
  }>;
}

// API calls
export const productsApi = {
  list: () => api.get<Product[]>("/products"),
  create: (data: { boss_number: string; name?: string; description?: string }) =>
    api.post<Product>("/products", data),
  get: (id: number) => api.get<Product>(`/products/${id}`),
  update: (id: number, data: Partial<Product>) => api.patch<Product>(`/products/${id}`, data),
};

export const documentsApi = {
  list: (params?: { product_id?: number; scope?: string; category?: string }) =>
    api.get<Document[]>("/documents", { params }),
  upload: (formData: FormData) =>
    api.post<Document>("/documents/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  classify: (id: number, category: string, product_id?: number) =>
    api.patch(`/documents/${id}/classify`, { category, product_id }),
  categories: () => api.get<{ categories: string[] }>("/documents/categories"),
  download: (id: number) => `/api/documents/${id}/download`,
  delete: (id: number) => api.delete(`/documents/${id}`),
  reextract: (id: number) => api.post<{ id: number; page_count: number; chars: number; has_page_markers: boolean }>(`/documents/${id}/reextract`),
};

export interface DocExtractionStat {
  doc_id: number;
  doc_name: string;
  doc_type: string;
  page_count?: number | null;
  items_raw: number;
  items_final?: number;
  items_sourced: number;
  pct_sourced?: number;
  categories_covered?: string[];
  categories_empty?: string[];
}

export interface ReferentielVersion {
  version: number;
  label: string;
  created_at: string | null;
  item_count: number;
  file_path?: string | null;
  document_ids?: number[];
  doc_stats?: Record<string, DocExtractionStat>;
}

export interface FicheVersion {
  version: number;
  label: string;
  created_at: string | null;
  item_count: number;
  document_ids: number[];
  referentiel_version?: number | null;
  complementary_document_ids?: number[];
}

export interface ReferentielFilters {
  category?: string;
  conflict?: boolean;
  version?: number;
  confidence_max?: number;
  source_doc_id?: number;
}

export interface GenerateResult {
  message: string;
  count: number;
  conflict_count: number;
  sourced_count?: number;
  pct_sourced?: number;
}

export const referentielApi = {
  generate: (product_id: number, document_ids: number[]) =>
    apiLong.post<GenerateResult>(`/referentiel/${product_id}/generate`, { document_ids }),
  list: (product_id: number, filters: ReferentielFilters = {}) =>
    api.get<ReferentielItem[]>(`/referentiel/${product_id}`, {
      params: Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== undefined && v !== null)
      ),
    }),
  versions: (product_id: number) =>
    api.get<ReferentielVersion[]>(`/referentiel/${product_id}/versions`),
  update: (product_id: number, item_id: number, data: Partial<ReferentielItem>) =>
    api.patch(`/referentiel/${product_id}/items/${item_id}`, data),
  updateVersion: (product_id: number, base_version: number, new_document_ids: number[]) =>
    apiLong.post(`/referentiel/${product_id}/update-version`, { base_version, new_document_ids }),
  deleteVersion: (product_id: number, version_number: number) =>
    api.delete(`/referentiel/${product_id}/versions/${version_number}`),
  exportExcel: (product_id: number) => `/api/referentiel/${product_id}/export`,
};

export const reportingApi = {
  portfolio: () => api.get<PortfolioKPIs>("/reporting/portfolio"),
  documents: () => api.get("/reporting/documents"),
  recetteStats: () => api.get("/reporting/recette-stats"),
  nonregStats: () => api.get("/reporting/nonreg-stats"),
  ficheStats: () => api.get("/reporting/fiche-stats"),
  validateModule: (productId: number, module: string) =>
    api.patch(`/reporting/products/${productId}/validate?module=${module}`),
};

export interface SyncResult {
  products_created: string[];
  docs_imported: string[];
  referentiels_generated: string[];
  errors: string[];
}

export const syncApi = {
  scan: () => api.post<SyncResult>("/sync/scan"),
};

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const chatApi = {
  send: (message: string, product_id?: number | null, history: ChatMessage[] = []) =>
    api.post<{ response: string }>("/chat/message", { message, product_id, history }),
};

// ── Fiches Produit KELIA ─────────────────────────────────────────────────────

export interface FicheItem {
  id: number;
  product_id: number;
  version_number: number;
  sheet: string;
  section?: string;
  parameter: string;
  valeurs_possibles?: string;
  kelia_comment?: string;
  value?: string;
  source_document_ids?: string;
  source_document_id?: number;
  source_paragraph?: string;
  source_citation?: string;
  ai_confidence?: number;
  ai_comment?: string;
  conflict?: boolean;
  cr_override?: boolean;
}

export interface TemplateCheck {
  exists: boolean;
  filename: string;
  path: string;
  status: string;
}

export interface EcartItem {
  id: number;
  rule_name: string;
  rule_value?: string;
  category?: string;
  source_document_name?: string;
  source_page?: number | null;
  source_section?: string | null;
  source_paragraph?: string | null;
  ecart_type?: string;
  ai_confidence?: number | null;
}

export interface DocReadingReport {
  id: number;
  document_name: string;
  document_type: string;
  file_size_bytes?: number | null;
  page_count?: number | null;
  section_count?: number | null;
  table_count?: number | null;
  paragraph_count?: number | null;
  char_count?: number | null;
  chunk_count?: number | null;
  token_estimate?: number | null;
  pct_read?: number | null;
  items_extracted?: number;
  status: string;
  referentiel_version: number;
}

// ── Fiche Produit 2 (direct depuis documents) ────────────────────────────────

export interface DocWarning {
  type: string;
  severity: "critique" | "important" | "recommande";
  doc_type: string;
  message: string;
  recommendation: string;
}

export interface FicheDirectItem {
  id: number;
  product_id: number;
  version_number: number;
  sheet: string;
  section?: string;
  parameter: string;
  valeurs_possibles?: string;
  kelia_comment?: string;
  value?: string;
  status?: string;
  source_document_id?: number | null;
  source_paragraph?: string | null;
  source_citation?: string | null;
  source_page?: number | null;
  sources_json?: string | null;
  ai_confidence?: number | null;
  ai_comment?: string | null;
  conflict?: boolean;
  // Traçabilité complète
  confidence_pct?: number | null;
  justification?: string | null;
  reasoning?: string | null;
  source_extract?: string | null;
  hypotheses?: string | null;
  contradiction_detail?: string | null;
  // Correction métier
  user_value?: string | null;
  user_comment?: string | null;
  user_status?: string | null;  // "genere" | "a_arbitrer" | "valide_metier"
}

export interface FicheItemHistoryEntry {
  id: number;
  user_value: string | null;
  user_comment: string | null;
  user_status: string | null;
  changed_at: string | null;
}

export interface FicheExtraInfoItem {
  id: number;
  parameter: string;
  value: string;
  source_document: string;
  source_page?: number | null;
  source_extract?: string | null;
  comment?: string | null;
  recommendation: string;
  user_decision?: string | null;
  is_open_point: boolean;
  open_point_code?: string | null;
  open_point_impact?: string | null;
  open_point_action?: string | null;
}

export interface FicheDirectVersion {
  version: number;
  label: string;
  created_at: string | null;
  item_count: number;
  filled_count: number;
  document_ids: number[];
  warnings: DocWarning[];
  ref_rules_count: number;
  tokens_input?: number | null;
  tokens_output?: number | null;
  tokens_total?: number | null;
}

export interface TemplateVersion {
  filename: string;
  size_bytes: number;
  modified_at: string;
  is_current: boolean;
}

export interface FicheDirectExtractResult {
  extraction_version: number;
  warnings: DocWarning[];
  message: string;
}

export const ficheDirectApi = {
  generate: (
    product_id: number,
    document_ids: number[],
    provider: string = "anthropic",
    sheets?: string[],
    template_filename?: string,
  ) =>
    apiLong.post<{
      count: number;
      filled_count: number;
      conflict_count: number;
      avg_confidence_pct: number | null;
      message: string;
      warnings: DocWarning[];
      tokens_input?: number;
      tokens_output?: number;
      tokens_total?: number;
      version_number?: number;
    }>(`/fiche2/${product_id}/generate`, {
      document_ids,
      provider,
      sheets: sheets ?? null,
      template_filename: template_filename ?? null,
    }),

  checkDocuments: (product_id: number, document_ids: number[]) =>
    api.get<{ documents: { id: number; name: string; type: string }[]; warnings: DocWarning[] }>(
      `/fiche2/${product_id}/check-documents`,
      { params: { document_ids: document_ids.join(",") } }
    ),
  list: (
    product_id: number,
    params?: { sheet?: string; status?: string; confidence_max?: number; version?: number }
  ) =>
    api.get<FicheDirectItem[]>(`/fiche2/${product_id}`, {
      params: params
        ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined))
        : {},
    }),
  versions: (product_id: number) =>
    api.get<FicheDirectVersion[]>(`/fiche2/${product_id}/versions`),
  deleteVersion: (product_id: number, version_number: number) =>
    api.delete(`/fiche2/${product_id}/versions/${version_number}`),
  extraInfo: (product_id: number, version?: number) =>
    api.get<FicheExtraInfoItem[]>(
      `/fiche2/${product_id}/extra-info`,
      { params: version != null ? { version } : {} }
    ),
  updateExtraInfoDecision: (product_id: number, item_id: number, user_decision: string | null) =>
    api.patch(`/fiche2/${product_id}/extra-info/${item_id}`, { user_decision }),
  exportExcel: (product_id: number) => `/api/fiche2/${product_id}/export`,
  patchItem: (
    product_id: number,
    item_id: number,
    body: { user_value?: string | null; user_comment?: string | null; user_status?: string }
  ) => api.patch(`/fiche2/${product_id}/item/${item_id}`, body),
  bulkValidate: (product_id: number, item_ids: number[], user_status: string = "valide_metier") =>
    api.post(`/fiche2/${product_id}/items/bulk-validate`, { item_ids, user_status }),
  itemHistory: (product_id: number, item_id: number) =>
    api.get<FicheItemHistoryEntry[]>(`/fiche2/${product_id}/item/${item_id}/history`),
  templateVersions: () =>
    api.get<TemplateVersion[]>("/fiche2/template/versions"),
  updateConsigne: (parameter: string, sheet: string, consigne: string, create_template: boolean) =>
    api.patch<{ updated_items: number; template_version: string | null }>("/fiche2/template/consigne", {
      parameter,
      sheet,
      consigne,
      create_template,
    }),
};

// ── Recette Paramétrage ───────────────────────────────────────────────────────

export interface RecetteFppVersion {
  version: number;
  label: string;
  created_at: string | null;
  item_count: number;
  filled_count: number;
}

export interface RegrItem {
  sheet: string;
  parameter: string;
  v_ref_value: string | null;
  v_new_value: string | null;
  status: "stable" | "modified" | "regression" | "added" | "removed";
  v_ref_status: string | null;
  v_new_status: string | null;
  section: string | null;
}

export interface RegrResult {
  v_ref: number;
  v_new: number;
  summary: { stable: number; modified: number; regression: number; added: number; removed: number };
  items: RegrItem[];
}

export interface CompareItem {
  produit_kelia: string;
  parametre_kelia: string | null;
  valeur_kelia: string | null;
  parametre_fpp: string | null;
  valeur_fpp: string | null;
  sheet: string | null;
  status: "conforme" | "non_conforme" | "non_retrouve" | "incertain";
  confiance_matching: "certain" | "probable" | "incertain";
  explication: string;
  trouve_dans_fpp: boolean;
}

export interface ProductStats {
  total: number;
  conforme: number;
  non_conforme: number;
  non_retrouve: number;
  incertain: number;
  taux_conformite: number;
}

export type RecetteAnnotation = { user_status: string; user_comment: string };

export interface CompareResult {
  history_id?: number;
  fpp_version: number;
  kelia_rows: number;
  fpp_rows: number;
  summary: { conforme: number; non_conforme: number; non_retrouve: number; incertain: number };
  taux_conformite: number;
  statut_global: string;
  products: Record<string, ProductStats>;
  items: CompareItem[];
  annotations?: Record<string, RecetteAnnotation>;
}

export interface RecetteHistoryEntry {
  id: number;
  fpp_version: number;
  filename_kelia: string | null;
  provider: string;
  created_at: string | null;
  kelia_rows: number;
  taux_conformite: number;
  statut_global: string;
}

export interface NonRegItem {
  parametre_f1: string | null;
  valeur_f1: string | null;
  parametre_f2: string | null;
  valeur_f2: string | null;
  status: "stable" | "modifie" | "supprime" | "ajoute";
  confiance_matching: "certain" | "probable" | "incertain";
  explication: string;
}

export interface NonRegResult {
  filename1: string;
  filename2: string;
  f1_rows: number;
  f2_rows: number;
  summary: { stable: number; modifie: number; supprime: number; ajoute: number };
  items: NonRegItem[];
}

export const recetteApi = {
  versions: (product_id: number) =>
    api.get<RecetteFppVersion[]>(`/recette/${product_id}/versions`),
  nonRegression: (product_id: number, v_ref: number, v_new: number) =>
    api.get<RegrResult>(`/recette/${product_id}/regr`, { params: { v_ref, v_new } }),
  compare: (product_id: number, fpp_version: number, file: File, provider: string) => {
    const fd = new FormData();
    fd.append("fpp_version", String(fpp_version));
    fd.append("file", file);
    fd.append("provider", provider);
    return apiLong.post<CompareResult>(`/recette/${product_id}/compare`, fd);
  },
  historyList: (product_id: number) =>
    api.get<RecetteHistoryEntry[]>(`/recette/${product_id}/history`),
  historyDetail: (history_id: number) =>
    api.get<CompareResult>(`/recette/history/${history_id}`),
  updateAnnotations: (history_id: number, annotations: Record<string, RecetteAnnotation>) =>
    api.patch(`/recette/history/${history_id}/annotations`, annotations),
  nonreg: (product_id: number, file1: File, file2: File, provider: string) => {
    const fd = new FormData();
    fd.append("file1", file1);
    fd.append("file2", file2);
    fd.append("provider", provider);
    return apiLong.post<NonRegResult>(`/recette/${product_id}/nonreg`, fd);
  },
};

// ── Non-régression (fichiers KELIA) ──────────────────────────────────────────

export interface NRItem {
  parametre: string;
  valeur_v1: string | null;
  valeur_v2: string | null;
  commentaire_v1: string | null;
  commentaire_v2: string | null;
  status: "conforme" | "ecart" | "nouveau" | "supprime";
  criticite: "critique" | "élevé" | "moyen" | "faible";
  explication: string | null;
  impact_metier: string | null;
  remarques: string | null;
  recommandation: string | null;
}

export interface NRResult {
  history_id?: number;
  v1_name: string;
  v2_name: string;
  v1_count: number;
  v2_count: number;
  controles_realises: number;
  taux_conformite: number;
  synthese: string;
  regressions_prioritaires: string[];
  recommandations: string[];
  summary: { conforme: number; ecart: number; nouveau: number; supprime: number };
  criticite_summary: { critique: number; "élevé": number; moyen: number; faible: number };
  parsing_warning: string | null;
  items: NRItem[];
  annotations?: Record<string, RecetteAnnotation>;
}

export interface NRPreview {
  filename: string;
  total_rows: number;
  preview: { parametre: string; valeur: string; commentaire: string }[];
}

export interface NRHistoryEntry {
  id: number;
  filename_v1: string;
  filename_v2: string;
  provider: string;
  created_at: string | null;
  v1_rows: number;
  v2_rows: number;
  taux_stable: number;
}

export const nonRegressionApi = {
  compare: (fileV1: File, fileV2: File, provider: string, productId: number) => {
    const fd = new FormData();
    fd.append("file_v1", fileV1);
    fd.append("file_v2", fileV2);
    fd.append("provider", provider);
    fd.append("product_id", String(productId));
    return apiLong.post<NRResult>("/non-regression/compare", fd);
  },
  historyList: (productId: number) =>
    api.get<NRHistoryEntry[]>(`/non-regression/${productId}/history`),
  historyDetail: (historyId: number) =>
    api.get<NRResult>(`/non-regression/history/${historyId}`),
  updateAnnotations: (historyId: number, annotations: Record<string, RecetteAnnotation>) =>
    api.patch(`/non-regression/history/${historyId}/annotations`, annotations),
  preview: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<NRPreview>("/non-regression/preview", fd);
  },
};

// ── Conformité contractuelle ──────────────────────────────────────────────────

export interface ConformiteEngagement {
  engagement: string;
  citation_cg: string;
  statut: "conforme" | "partiel" | "non_repris" | "validation_requise" | "sans_impact";
  risque_type: "juridique" | "actuariel" | "financier" | "operationnel" | "reglementaire" | null;
  risque_niveau: "critique" | "eleve" | "moyen" | "faible";
  reference_fpp: string | null;
  explication: string;
}

export interface ConformiteArticle {
  article: string;
  engagements: ConformiteEngagement[];
}

export interface ConformiteResult {
  score_conformite: number;
  resume: string;
  cg_filename: string;
  fpp_version: number;
  fpp_params: number;
  total_engagements: number;
  articles: ConformiteArticle[];
  summary: {
    conforme: number;
    partiel: number;
    non_repris: number;
    validation_requise: number;
    sans_impact: number;
  };
  history_id?: number;
  created_at?: string;
}

export interface ConformiteHistoryEntry {
  id: number;
  filename_kelia: string;
  filename_contract: string;
  provider: string;
  created_at: string | null;
  kelia_params: number;
  score_conformite: number;
}

export const conformiteApi = {
  analyze: (fileCG: File, provider: string, productId: number, fppVersion: number) => {
    const fd = new FormData();
    fd.append("file_cg", fileCG);
    fd.append("provider", provider);
    fd.append("product_id", String(productId));
    fd.append("fpp_version", String(fppVersion));
    return apiLong.post<ConformiteResult>("/conformite/analyze", fd);
  },
  historyList: (productId: number) =>
    api.get<ConformiteHistoryEntry[]>(`/conformite/${productId}/history`),
  historyDetail: (historyId: number) =>
    api.get<ConformiteResult>(`/conformite/history/${historyId}`),
};

export const fichesApi = {
  checkTemplate: () => api.get<TemplateCheck>("/fiches/check-template"),
  generate: (product_id: number, complementary_document_ids: number[], referentiel_version?: number) =>
    apiLong.post<{ count: number; conflict_count: number; message: string }>(
      `/fiches/${product_id}/generate`,
      { complementary_document_ids, referentiel_version: referentiel_version ?? null }
    ),
  list: (
    product_id: number,
    params?: {
      sheet?: string;
      conflict?: boolean;
      confidence_max?: number;
      version?: number;
    }
  ) =>
    api.get<FicheItem[]>(`/fiches/${product_id}`, {
      params: params
        ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined))
        : {},
    }),
  versions: (product_id: number) =>
    api.get<FicheVersion[]>(`/fiches/${product_id}/versions`),
  deleteVersion: (product_id: number, version_number: number) =>
    api.delete(`/fiches/${product_id}/versions/${version_number}`),
  exportExcel: (product_id: number) => `/api/fiches/${product_id}/export`,
  ecarts: (product_id: number, version?: number) =>
    api.get<EcartItem[]>(`/fiches/${product_id}/ecarts`, { params: version != null ? { version } : {} }),
  readingReport: (product_id: number, referentiel_version?: number) =>
    api.get<DocReadingReport[]>(`/fiches/${product_id}/reading-report`, {
      params: referentiel_version != null ? { referentiel_version } : {},
    }),
};
