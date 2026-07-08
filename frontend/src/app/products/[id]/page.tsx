"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/layout/Header";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DocumentList } from "@/components/documents/DocumentList";
import { DocumentUpload } from "@/components/documents/DocumentUpload";
import { productsApi } from "@/lib/api";
import { Package } from "lucide-react";
import Link from "next/link";

export default function ProductDetailPage() {
  const { id } = useParams();
  const productId = Number(id);

  const { data: product, isLoading } = useQuery({
    queryKey: ["product", productId],
    queryFn: () => productsApi.get(productId).then((r) => r.data),
    enabled: !!productId,
  });

  if (isLoading) return <div className="text-center py-12 text-gray-400">Chargement...</div>;
  if (!product) return <div className="text-center py-12 text-gray-400">Produit introuvable</div>;

  const steps = [
    { key: "status_referentiel" as const, label: "Référentiel", href: `/referentiel?product=${productId}` },
    { key: "status_fiche" as const, label: "Fiche Produit", href: `/fiches?product=${productId}` },
    { key: "status_parametrage" as const, label: "Paramétrage", href: `/parametrage?product=${productId}` },
    { key: "status_recette" as const, label: "Recette", href: `/recette?product=${productId}` },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
        <Link href="/products" className="hover:text-blue-600">Produits</Link>
        <span>/</span>
        <span className="text-gray-700">BOSS {product.boss_number}</span>
      </div>

      <Header
        title={`BOSS ${product.boss_number}`}
        subtitle={product.name || product.description || "Produit d'assurance-vie"}
      />

      {/* Status cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {steps.map((step) => (
          <Link key={step.key} href={step.href} className="card hover:shadow-md transition-shadow cursor-pointer block">
            <p className="text-xs text-gray-500 mb-1">{step.label}</p>
            <StatusBadge status={product[step.key]} size="md" />
          </Link>
        ))}
      </div>

      {/* Documents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-4">Déposer des documents</h2>
          <DocumentUpload productId={productId} scope="produit" />
        </div>
        <div className="lg:col-span-2 card">
          <h2 className="font-semibold text-gray-800 mb-4">
            Documents du produit ({product.document_count})
          </h2>
          <DocumentList productId={productId} />
        </div>
      </div>
    </div>
  );
}
