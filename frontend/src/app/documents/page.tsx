"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Header } from "@/components/layout/Header";
import { DocumentList } from "@/components/documents/DocumentList";
import { productsApi, syncApi, SyncResult } from "@/lib/api";
import { RefreshCw, Library, CheckCircle, AlertCircle, FolderOpen, Pencil, X, Save, RotateCcw, FolderSearch } from "lucide-react";

type Tab = "generique" | "produit";

export default function DocumentsPage() {
  const [tab, setTab] = useState<Tab>("produit");
  const [selectedProduct, setSelectedProduct] = useState<number | undefined>();
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const queryClient = useQueryClient();

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.list().then((r) => r.data),
  });

  const { data: pathInfo, refetch: refetchPath } = useQuery({
    queryKey: ["sync-storage-path"],
    queryFn: () => syncApi.getStoragePath().then((r) => r.data),
  });

  const setPathMutation = useMutation({
    mutationFn: (dir: string) => syncApi.setStoragePath(dir).then((r) => r.data),
    onSuccess: () => {
      refetchPath();
      setEditingPath(false);
    },
  });

  const resetPathMutation = useMutation({
    mutationFn: () => syncApi.resetStoragePath().then((r) => r.data),
    onSuccess: () => refetchPath(),
  });

  const [browsing, setBrowsing] = useState(false);
  async function handleBrowse() {
    setBrowsing(true);
    try {
      const res = await syncApi.browseFolder();
      if (res.data.path) setPathInput(res.data.path);
    } finally {
      setBrowsing(false);
    }
  }

  const syncMutation = useMutation({
    mutationFn: () => syncApi.scan().then((r) => r.data),
    onSuccess: (data) => {
      setSyncResult(data);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const totalImported =
    (syncResult?.products_created.length ?? 0) +
    (syncResult?.docs_imported.length ?? 0) +
    (syncResult?.referentiels_generated.length ?? 0);

  function startEdit() {
    setPathInput(pathInfo?.storage_dir ?? "");
    setEditingPath(true);
  }

  return (
    <div>
      <Header
        title="Gestion Documentaire"
        subtitle="Déposez et qualifiez vos documents avant de démarrer l'analyse."
      />

      {/* Sync banner */}
      <div className="card mb-6 space-y-4">

        {/* Storage path config */}
        <div className="border border-[#E0E0E0] bg-[#FAFAFA] p-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="w-4 h-4 text-[#A100FF] shrink-0" />
              <span className="text-xs font-semibold text-black">Répertoire source</span>
              {pathInfo && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                  pathInfo.is_custom
                    ? "bg-purple-100 text-purple-700 border border-purple-200"
                    : "bg-[#F2F2F2] text-[#6A6A6A] border border-[#E0E0E0]"
                }`}>
                  {pathInfo.is_custom ? "Partagé" : "Local"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {!editingPath && pathInfo?.is_custom && (
                <button
                  onClick={() => resetPathMutation.mutate()}
                  disabled={resetPathMutation.isPending}
                  title="Revenir au chemin local par défaut"
                  className="text-[#6A6A6A] hover:text-black p-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              {!editingPath && (
                <button
                  onClick={startEdit}
                  className="text-[#6A6A6A] hover:text-[#A100FF] p-1"
                  title="Modifier le répertoire"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {editingPath ? (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  placeholder="Ex: C:\Users\...\OneDrive - Accenture\01ApplicactionCartoProduit\storage"
                  className="flex-1 text-xs font-mono border border-[#A100FF] bg-white px-2 py-1.5 outline-none min-w-0"
                />
                <button
                  onClick={handleBrowse}
                  disabled={browsing}
                  className="flex items-center gap-1.5 text-xs px-2 py-1.5 border border-[#A100FF] text-[#A100FF] bg-white hover:bg-purple-50 whitespace-nowrap"
                >
                  <FolderSearch className="w-3.5 h-3.5" />
                  {browsing ? "…" : "Parcourir"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPathMutation.mutate(pathInput)}
                  disabled={setPathMutation.isPending || !pathInput.trim()}
                  className="btn-primary flex items-center gap-1 text-xs px-2 py-1.5"
                >
                  <Save className="w-3 h-3" />
                  {setPathMutation.isPending ? "…" : "Valider"}
                </button>
                <button
                  onClick={() => setEditingPath(false)}
                  className="text-xs text-[#6A6A6A] hover:text-black px-2 py-1.5 border border-[#E0E0E0] bg-white"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-[11px] font-mono text-[#3A3A3A] truncate">
              {pathInfo?.storage_dir ?? "…"}
            </p>
          )}

          {setPathMutation.isError && (
            <p className="mt-1 text-[10px] text-red-600">
              {String((setPathMutation.error as Error)?.message ?? "Chemin invalide")}
            </p>
          )}

          {!editingPath && pathInfo && (
            <p className="mt-1 text-[10px] text-[#6A6A6A]">
              Scanne{" "}
              <code className="bg-white border border-[#E0E0E0] px-1">{pathInfo.storage_dir}\documents\produits\</code>{" "}
              et{" "}
              <code className="bg-white border border-[#E0E0E0] px-1">{pathInfo.storage_dir}\documents\generique\</code>
            </p>
          )}
        </div>

        {/* Sync action */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm font-semibold text-black">Synchronisation des dossiers</p>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Synchronisation…" : "Synchroniser les dossiers"}
          </button>
        </div>

        {syncMutation.isError && (
          <div className="flex items-start gap-2 text-[#FF3333] text-sm bg-red-50 border border-red-200 px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <strong>Erreur lors de la synchronisation.</strong>
              <div className="text-xs mt-0.5 text-red-700">
                {String((syncMutation.error as Error)?.message ?? "Erreur inconnue")}
              </div>
            </div>
          </div>
        )}

        {syncResult && !syncMutation.isPending && (
          <div className="border-t border-[#E0E0E0] pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium text-black">
                {totalImported === 0 && syncResult.errors.length === 0
                  ? "Aucune nouveauté détectée — tout est à jour."
                  : "Synchronisation terminée."}
              </span>
            </div>

            {totalImported > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SyncStat label="Produits créés" items={syncResult.products_created} color="purple" />
                <SyncStat label="Documents importés" items={syncResult.docs_imported} color="green" />
                <SyncStat label="Référentiels générés" items={syncResult.referentiels_generated} color="purple" />
              </div>
            )}

            {syncResult.errors.length > 0 && (
              <div className="border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-xs font-semibold text-amber-800">
                    {syncResult.errors.length} erreur(s) non bloquante(s) — les autres produits ont été traités normalement.
                  </span>
                </div>
                <ul className="space-y-1">
                  {syncResult.errors.map((err, i) => (
                    <li key={i} className="text-[10px] text-amber-900 font-mono bg-white border border-amber-100 px-2 py-1 truncate">
                      {err.split("\n")[0]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#E0E0E0] mb-6">
        {[
          { key: "produit" as Tab, label: "Documents Produit" },
          { key: "generique" as Tab, label: "Documentation Générique" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-[#A100FF] text-[#A100FF]"
                : "border-transparent text-[#6A6A6A] hover:text-black"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "produit" && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-black mb-2">Produit BOSS</label>
          <select
            value={selectedProduct ?? ""}
            onChange={(e) => setSelectedProduct(e.target.value ? Number(e.target.value) : undefined)}
            className="border border-[#E0E0E0] px-3 py-2 bg-white text-sm text-black w-64 focus:outline-none focus:ring-1 focus:ring-[#A100FF]"
            style={{ borderRadius: 0 }}
          >
            <option value="">— Tous les produits —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                BOSS {p.boss_number}{p.name ? ` — ${p.name}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Library className="w-5 h-5 text-[#A100FF]" />
          <h2 className="font-semibold text-black">
            {tab === "generique" ? "Documentation Générique" : "Documents Produits"}
          </h2>
        </div>
        <DocumentList
          productId={tab === "produit" ? selectedProduct : undefined}
          scope={tab}
        />
      </div>
    </div>
  );
}

function SyncStat({
  label,
  items,
  color,
}: {
  label: string;
  items: string[];
  color: "purple" | "green";
}) {
  const colors = {
    purple: "bg-[#F3E0FF] border-[#E5B3FF] text-[#7700CC]",
    green: "bg-green-50 border-green-200 text-green-700",
  };

  if (items.length === 0) return null;

  return (
    <div className={`border p-3 ${colors[color]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold">{items.length}</p>
      <ul className="mt-1 text-xs opacity-80 space-y-0.5">
        {items.slice(0, 5).map((item, i) => (
          <li key={i} className="truncate">• {item}</li>
        ))}
        {items.length > 5 && <li>…et {items.length - 5} autres</li>}
      </ul>
    </div>
  );
}
