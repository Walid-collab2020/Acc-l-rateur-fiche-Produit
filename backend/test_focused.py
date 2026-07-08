"""Test ciblé : IDENTIFICATION + TMG ET REVALORISATION uniquement"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from app.database import SessionLocal
from app.models.document import Document
from app.services.fiche_direct_service import (
    _build_documents_context, _call_llm_chunk
)
from app.services.ai_service import set_active_provider

set_active_provider("anthropic")

FIELDS = [
    # IDENTIFICATION DU PRODUIT TECHNIQUE
    {"parameter": "Code Produit Technique *", "section": "IDENTIFICATION DU PRODUIT TECHNIQUE",
     "valeurs_possibles": "Texte libre (ex: A83CAPI€)", "kelia_comment": ""},
    {"parameter": "Libellé Produit Technique *", "section": "IDENTIFICATION DU PRODUIT TECHNIQUE",
     "valeurs_possibles": "Texte libre", "kelia_comment": ""},
    {"parameter": "Compagnie *", "section": "IDENTIFICATION DU PRODUIT TECHNIQUE",
     "valeurs_possibles": "CMAV / MMP / QUATREM", "kelia_comment": ""},
    {"parameter": "Nature du produit *", "section": "IDENTIFICATION DU PRODUIT TECHNIQUE",
     "valeurs_possibles": "Retraite collective / Assurance vie / Capitalisation / Rente / PERO", "kelia_comment": ""},
    {"parameter": "Forme *", "section": "IDENTIFICATION DU PRODUIT TECHNIQUE",
     "valeurs_possibles": "En devises (€) / Multi-supports UC / Mixte", "kelia_comment": ""},
    {"parameter": "Type de contrat", "section": "IDENTIFICATION DU PRODUIT TECHNIQUE",
     "valeurs_possibles": "Affilié contrat groupe / Individuel / Collectif adhésion individuelle", "kelia_comment": ""},
    {"parameter": "N° version", "section": "IDENTIFICATION DU PRODUIT TECHNIQUE",
     "valeurs_possibles": "Entier (ex: 1)", "kelia_comment": ""},
    {"parameter": "Date de la version *", "section": "IDENTIFICATION DU PRODUIT TECHNIQUE",
     "valeurs_possibles": "Date JJ/MM/AAAA", "kelia_comment": ""},
    {"parameter": "Statut *", "section": "IDENTIFICATION DU PRODUIT TECHNIQUE",
     "valeurs_possibles": "Valide / En attente / Invalide", "kelia_comment": ""},
    {"parameter": "Ficovie (case à cocher)", "section": "IDENTIFICATION DU PRODUIT TECHNIQUE",
     "valeurs_possibles": "Oui / Non", "kelia_comment": ""},
    {"parameter": "Adhésion conjointe", "section": "IDENTIFICATION DU PRODUIT TECHNIQUE",
     "valeurs_possibles": "Oui / Non", "kelia_comment": ""},
    {"parameter": "Mentions légales", "section": "IDENTIFICATION DU PRODUIT TECHNIQUE",
     "valeurs_possibles": "Texte libre (optionnel)", "kelia_comment": ""},
    # TMG ET REVALORISATION
    {"parameter": "Type de revalorisation KELIA (T1/T2/T3/T4)", "section": "TMG ET REVALORISATION",
     "valeurs_possibles": "T1 : Revalorisation fin exercice / T2 : Pied de rantes / T3 : Taux servi contrat / T4 : PER (PERO)", "kelia_comment": ""},
    {"parameter": "Mode de calcul TMG", "section": "TMG ET REVALORISATION",
     "valeurs_possibles": "Par génération / Unique / Sans TMG", "kelia_comment": ""},
    {"parameter": "TMG net ou brut", "section": "TMG ET REVALORISATION",
     "valeurs_possibles": "Net / Brut (avant frais de gestion encours)", "kelia_comment": ""},
    {"parameter": "Origine du TMG", "section": "TMG ET REVALORISATION",
     "valeurs_possibles": "Réglementaire (taux technique) / Contractuel / Hybride", "kelia_comment": ""},
    {"parameter": "Taux provisoire (avant arrêté)", "section": "TMG ET REVALORISATION",
     "valeurs_possibles": "Ex: TMG / Taux estimé N-1 / Taux contractuel", "kelia_comment": ""},
    {"parameter": "Dérogation taux de revalorisation des rentes", "section": "TMG ET REVALORISATION",
     "valeurs_possibles": "Oui / Non", "kelia_comment": ""},
    {"parameter": "Clause de PB (participation aux bénéfices)", "section": "TMG ET REVALORISATION",
     "valeurs_possibles": "Oui / Non + taux min légal / Taux contractuel", "kelia_comment": ""},
    {"parameter": "Clause PPB (provision pour PB)", "section": "TMG ET REVALORISATION",
     "valeurs_possibles": "Oui / Non", "kelia_comment": ""},
]

db = SessionLocal()
# Product 650 = EXPERIDE, documents 8 et 9
docs = db.query(Document).filter(Document.id.in_([8, 9, 10])).all()
print(f"Documents: {[d.original_filename for d in docs]}")
ctx = _build_documents_context(docs)
print(f"Context: {len(ctx)} chars\n")

result = _call_llm_chunk("Produit Technique", FIELDS, ctx)
fields = result.get("fields", [])
print(f"Champs retournés: {len(fields)}/{len(FIELDS)}\n")
print("=" * 70)
for f in fields:
    val = f.get("value", "?")
    conf = f.get("confidence_pct", "?")
    just = f.get("justification", "")
    marker = "✓" if val and val != "Information manquante" else "✗"
    print(f"{marker} [{conf}%] {f.get('parameter')}")
    print(f"    → {val}")
    if just:
        print(f"    justif: {just}")
    print()

db.close()
