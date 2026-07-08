"use client";
import { Header } from "@/components/layout/Header";
import { Construction } from "lucide-react";

export default function ControlesPage() {
  return (
    <div>
      <Header title="Contrôles des Livraisons KELIA" subtitle="Étapes 5-6 — Contrôle et détection de régressions" />
      <div className="card text-center py-16">
        <Construction className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
        <p className="text-gray-600 font-medium">Module en cours de développement</p>
        <p className="text-sm text-gray-400 mt-1">
          Comparaison automatique livraison KELIA vs fiche cible validée, détection de régressions
        </p>
      </div>
    </div>
  );
}
