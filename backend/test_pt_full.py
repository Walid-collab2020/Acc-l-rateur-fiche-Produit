"""Test complet Produit Technique — 113 champs, chunking, docs 8+9+10"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from app.database import SessionLocal
from app.models.document import Document
from app.services.fiche_direct_service import (
    _build_documents_context, _read_template_item_list, _call_llm_for_sheet, CHUNK_SIZE
)
from app.services.ai_service import set_active_provider

set_active_provider("anthropic")

db = SessionLocal()
docs = db.query(Document).filter(Document.id.in_([8, 9, 10])).all()
print(f"Documents: {[d.original_filename for d in docs]}")
ctx = _build_documents_context(docs)
print(f"Context: {len(ctx)} chars")

items = _read_template_item_list()
pt_fields = items.get("Produit Technique", [])
n_chunks = (len(pt_fields) - 1) // CHUNK_SIZE + 1
print(f"Produit Technique: {len(pt_fields)} champs -> {n_chunks} chunks de {CHUNK_SIZE}\n")

result = _call_llm_for_sheet("Produit Technique", "", ctx, template_fields=pt_fields)
fields = result.get("fields", [])

filled = [f for f in fields if f.get("value") and f.get("value") != "Information manquante"]
missing = [f for f in fields if not f.get("value") or f.get("value") == "Information manquante"]

print(f"Champs retournés : {len(fields)}/{len(pt_fields)}")
print(f"Remplis          : {len(filled)}")
print(f"Manquants        : {len(missing)}")
if result.get("error"):
    print(f"ERREUR globale   : {result['error']}")

# Résultats par section
sections = {}
for f in fields:
    sec = f.get("section") or "Sans section"
    sections.setdefault(sec, []).append(f)

print("\n--- DÉTAIL PAR SECTION ---")
for sec, sec_fields in sections.items():
    ok = [f for f in sec_fields if f.get("value") and f.get("value") != "Information manquante"]
    print(f"\n{sec} ({len(ok)}/{len(sec_fields)})")
    for f in sec_fields:
        val = f.get("value", "?")
        conf = f.get("confidence_pct", "?")
        marker = "✓" if val and val != "Information manquante" else "✗"
        print(f"  {marker} [{conf}%] {f.get('parameter')}")
        if val and val != "Information manquante":
            print(f"       → {val[:120]}")

db.close()
