"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Header } from "@/components/layout/Header";
import { DocumentList } from "@/components/documents/DocumentList";
import { productsApi, syncApi, SyncResult } from "@/lib/api";
import { RefreshCw, Library, CheckCircle, AlertCircle, FolderOpen } from "lucide-react";

type Tab = "generique" | "produit";

export default function DocumentsPage() {
  const [tab, setTab] = useState<Tab>("produit");
  const [selectedProduct, setSelectedProduct] = useState<number | undefined>();
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const queryClient = useQueryClient();

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.list().then((r) => r.data),
  });

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

  return (
    <div>
      <Header
        title="Gestion Documentaire"
        subtitle="Déposez et qualifiez vos documents avant de démarrer l'analyse."
      />

      {/* Sync banner */}
      <div className="card mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <FolderOpen className="w-5 h-5 text-[#A100FF] shrink-0" />
            <div>
              <p className="font-semibold text-black text-sm">Synchronisation des dossiers</p>
              <p className="text-xs text-[#6A6A6A]">
                Scanne <code className="bg-[#F2F2F2] px-1">storage/documents/produits/</code> et{" "}
                <code className="bg-[#F2F2F2] px-1">storage/documents/generique/</code>
              </p>
            </div>
          </div>
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
          <div className="mt-4 flex items-start gap-2 text-[#FF3333] text-sm bg-red-50 border border-red-200 px-3 py-2">
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
          <div className="mt-4 border-t border-[#E0E0E0] pt-4 space-y-3">
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
