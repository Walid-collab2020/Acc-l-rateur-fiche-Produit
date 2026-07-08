"use client";
import { Header } from "@/components/layout/Header";
import { Settings, Construction } from "lucide-react";

export default function ParametragePage() {
  return (
    <div>
      <Header title="Paramétrage Cible KELIA" subtitle="Étape 3 — Génération du paramétrage cible" />
      <div className="card text-center py-16">
        <Construction className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
        <p className="text-gray-600 font-medium">Module en cours de développement</p>
        <p className="text-sm text-gray-400 mt-1">
          Génération du paramétrage KELIA avec mapping BOSS → KELIA
        </p>
        <div className="mt-6 text-left max-w-lg mx-auto bg-gray-50 rounded-xl p-4 text-sm text-gray-600">
          <p className="font-medium mb-2">Modules couverts :</p>
          <ul className="space-y-1 list-disc list-inside text-gray-500">
            <li>Produit, Supports, Garanties, Frais</li>
            <li>Fiscalité, Actes de gestion, Workflow</li>
            <li>Règles financières, Règles de calcul, Options</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
