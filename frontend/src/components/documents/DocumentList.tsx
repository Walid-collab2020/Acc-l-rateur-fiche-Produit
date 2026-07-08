"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2, Edit2, Check, X, FileText, FileSpreadsheet, File, RefreshCw } from "lucide-react";
import { documentsApi, Document } from "@/lib/api";
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";
import clsx from "clsx";

interface DocumentListProps {
  productId?: number;
  scope?: string;
}

const CATEGORIES = [
  "Conditions Générales", "Note Technique Actuarielle", "Notice", "Avenant",
  "Extraction BOSS", "Fiche Produit", "Paramétrage KELIA", "Compte-rendu Atelier",
  "Décision de conception", "Arbitrage", "Documentation complémentaire",
  "Documentation Générique", "Autres",
];

function FileIcon({ mime }: { mime?: string }) {
  if (mime?.includes("pdf")) return <FileText className="w-5 h-5 text-[#FF3333]" />;
  if (mime?.includes("sheet") || mime?.includes("excel")) return <FileSpreadsheet className="w-5 h-5 text-green-600" />;
  return <File className="w-5 h-5 text-[#6A6A6A]" />;
}

export function DocumentList({ productId, scope }: DocumentListProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["documents", productId, scope, filterCategory],
    queryFn: () => documentsApi.list({ product_id: productId, scope, category: filterCategory || undefined }).then((r) => r.data),
  });

  const classifyMutation = useMutation({
    mutationFn: ({ id, category }: { id: number; category: string }) =>
      documentsApi.classify(id, category, productId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => documentsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });

  const [reextractResult, setReextractResult] = useState<Record<number, { chars: number; page_count: number; has_page_markers: boolean }>>({});
  const reextractMutation = useMutation({
    mutationFn: (docId: number) => documentsApi.reextract(docId).then((r) => ({ docId, ...r.data })),
    onSuccess: (data) => {
      setReextractResult((prev) => ({ ...prev, [data.docId]: data }));
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const formatSize = (bytes?: number) => {
    if (!bytes) return "—";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  };

  if (isLoading) {
    return (
      <div className="text-center py-12 text-[#6A6A6A]">
        <div className="animate-spin w-6 h-6 border-2 border-[#A100FF] border-t-transparent mx-auto mb-2" />
        Chargement...
      </div>
    );
  }

  return (
    <div>
      {/* Filter */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="text-sm border border-[#E0E0E0] px-3 py-1.5 bg-white text-black focus:outline-none focus:ring-1 focus:ring-[#A100FF]"
          style={{ borderRadius: 0 }}
        >
          <option value="">Toutes les catégories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-sm text-[#6A6A6A]">{docs.length} document(s)</span>
      </div>

      {docs.length === 0 ? (
        <div className="text-center py-12 text-[#6A6A6A]">
          <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Aucun document</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-[#E0E0E0]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F2F2F2] border-b border-[#E0E0E0]">
                <th className="text-left px-4 py-3 font-medium text-[#6A6A6A]">Fichier</th>
                <th className="text-left px-4 py-3 font-medium text-[#6A6A6A]">Catégorie</th>
                <th className="text-left px-4 py-3 font-medium text-[#6A6A6A]">Pages</th>
                <th className="text-left px-4 py-3 font-medium text-[#6A6A6A]">Taille</th>
                <th className="text-left px-4 py-3 font-medium text-[#6A6A6A]">Date</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2F2F2]">
              {docs.map((doc) => (
                <tr key={doc.id} className="bg-white hover:bg-[#F2F2F2] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileIcon mime={doc.mime_type} />
                      <div>
                        <p className="font-medium text-black max-w-xs truncate">{doc.original_filename}</p>
                        {doc.ai_summary && (
                          <p className="text-xs text-[#6A6A6A] max-w-xs truncate mt-0.5">{doc.ai_summary}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {editingId === doc.id ? (
                      <div className="flex items-center gap-1">
                        <select
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          className="text-xs border border-[#A100FF] px-2 py-1 bg-white focus:outline-none"
                          style={{ borderRadius: 0 }}
                          autoFocus
                        >
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button onClick={() => classifyMutation.mutate({ id: doc.id, category: editCategory })}>
                          <Check className="w-4 h-4 text-green-600" />
                        </button>
                        <button onClick={() => setEditingId(null)}>
                          <X className="w-4 h-4 text-[#6A6A6A]" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className={clsx(
                          "text-xs px-2 py-0.5",
                          doc.category_confirmed
                            ? "bg-green-50 text-green-700"
                            : "bg-yellow-50 text-yellow-700"
                        )}>
                          {doc.category || "Non classifié"}
                        </span>
                        <button
                          onClick={() => { setEditingId(doc.id); setEditCategory(doc.category || ""); }}
                          className="text-[#6A6A6A] hover:text-black"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#6A6A6A]">
                    {doc.page_count ?? "—"}
                    {reextractResult[doc.id] && (
                      <span className={`ml-1 text-xs font-medium ${reextractResult[doc.id].has_page_markers ? "text-green-600" : "text-amber-600"}`}>
                        {reextractResult[doc.id].has_page_markers ? "✓ pages" : "⚠ sans pages"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#6A6A6A]">{formatSize(doc.file_size)}</td>
                  <td className="px-4 py-3 text-[#6A6A6A] text-xs">
                    {doc.created_at ? new Date(doc.created_at).toLocaleDateString("fr-FR") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <a
                        href={documentsApi.download(doc.id)}
                        download
                        className="p-1.5 text-[#6A6A6A] hover:text-[#A100FF] transition-colors"
                        title="Télécharger"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                      <button
                        onClick={() => reextractMutation.mutate(doc.id)}
                        disabled={reextractMutation.isPending && reextractMutation.variables === doc.id}
                        className="p-1.5 text-[#6A6A6A] hover:text-[#A100FF] transition-colors disabled:opacity-40"
                        title="Ré-extraire le texte avec marqueurs de pages"
                      >
                        <RefreshCw className={`w-4 h-4 ${reextractMutation.isPending && reextractMutation.variables === doc.id ? "animate-spin" : ""}`} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("Supprimer ce document ?")) deleteMutation.mutate(doc.id);
                        }}
                        className="p-1.5 text-[#6A6A6A] hover:text-[#FF3333] transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
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
