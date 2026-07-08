"use client";
import { Header } from "@/components/layout/Header";
import { Construction } from "lucide-react";

export default function AteliersPage() {
  return (
    <div>
      <Header title="Ateliers & Arbitrages" subtitle="Étape 4 — Gestion des ateliers et mises à jour" />
      <div className="card text-center py-16">
        <Construction className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
        <p className="text-gray-600 font-medium">Module en cours de développement</p>
        <p className="text-sm text-gray-400 mt-1">
          Analyse IA des CR d'ateliers, détection d'impacts et mise à jour du référentiel
        </p>
      </div>
    </div>
  );
}
