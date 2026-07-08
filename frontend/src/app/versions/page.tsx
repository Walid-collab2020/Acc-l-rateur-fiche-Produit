"use client";
import { Header } from "@/components/layout/Header";
import { Construction } from "lucide-react";

export default function VersionsPage() {
  return (
    <div>
      <Header title="Gestion du Versionning" subtitle="Étape 9 — Historisation et comparaison de versions" />
      <div className="card text-center py-16">
        <Construction className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
        <p className="text-gray-600 font-medium">Module en cours de développement</p>
        <p className="text-sm text-gray-400 mt-1">
          Versioning automatique V1/V2/V3, comparaison et restauration de versions
        </p>
      </div>
    </div>
  );
}
