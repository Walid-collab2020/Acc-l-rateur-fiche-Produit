"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Header } from "@/components/layout/Header";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { productsApi, Product } from "@/lib/api";
import { Plus, Package, FileText, X } from "lucide-react";
import Link from "next/link";

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ boss_number: "", name: "", description: "" });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.list().then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => productsApi.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setForm({ boss_number: "", name: "", description: "" });
      setShowForm(false);
    },
  });

  const stepCols = [
    { key: "status_referentiel", label: "Référentiel" },
    { key: "status_fiche", label: "Fiche Produit" },
    { key: "status_parametrage", label: "Paramétrage" },
    { key: "status_recette", label: "Recette" },
  ] as const;

  return (
    <div>
      <Header
        title="Produits BOSS"
        subtitle="Gestion du portefeuille de produits à migrer"
        actions={
          <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Nouveau produit
          </button>
        }
      />

      {/* Create form */}
      {showForm && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-black">Créer un produit</h2>
            <button onClick={() => setShowForm(false)} className="text-[#6A6A6A] hover:text-black">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-black mb-1">Numéro BOSS *</label>
              <input
                type="text"
                value={form.boss_number}
                onChange={(e) => setForm({ ...form, boss_number: e.target.value })}
                placeholder="ex: 503"
                className="w-full border border-[#E0E0E0] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#A100FF]"
                style={{ borderRadius: 0 }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-1">Nom</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nom du produit"
                className="w-full border border-[#E0E0E0] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#A100FF]"
                style={{ borderRadius: 0 }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Description courte"
                className="w-full border border-[#E0E0E0] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#A100FF]"
                style={{ borderRadius: 0 }}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!form.boss_number || createMutation.isPending}
              className="btn-primary"
            >
              {createMutation.isPending ? "Création..." : "Créer"}
            </button>
            <button onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
          </div>
          {createMutation.isError && (
            <p className="text-sm text-[#FF3333] mt-2">
              {(createMutation.error as any)?.response?.data?.detail || "Erreur lors de la création"}
            </p>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-[#6A6A6A]">Chargement...</div>
      ) : products.length === 0 ? (
        <div className="card text-center py-12">
          <Package className="w-12 h-12 mx-auto text-[#E0E0E0] mb-3" />
          <p className="text-[#6A6A6A]">Aucun produit. Commencez par en créer un.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-[#E0E0E0]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F2F2F2] border-b border-[#E0E0E0]">
                <th className="text-left px-4 py-3 font-medium text-[#6A6A6A]">N° BOSS</th>
                <th className="text-left px-4 py-3 font-medium text-[#6A6A6A]">Nom</th>
                <th className="text-left px-4 py-3 font-medium text-[#6A6A6A]">Documents</th>
                {stepCols.map((c) => (
                  <th key={c.key} className="text-left px-4 py-3 font-medium text-[#6A6A6A]">{c.label}</th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2F2F2]">
              {products.map((p) => (
                <tr key={p.id} className="bg-white hover:bg-[#F2F2F2] transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[#A100FF]">{p.boss_number}</td>
                  <td className="px-4 py-3 text-black">{p.name || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-[#6A6A6A]">
                      <FileText className="w-3.5 h-3.5" />
                      <span>{p.document_count}</span>
                    </div>
                  </td>
                  {stepCols.map((c) => (
                    <td key={c.key} className="px-4 py-3">
                      <StatusBadge status={p[c.key]} />
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <Link
                      href={`/products/${p.id}`}
                      className="text-xs text-[#A100FF] hover:text-[#7700CC] font-medium"
                    >
                      Voir →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
