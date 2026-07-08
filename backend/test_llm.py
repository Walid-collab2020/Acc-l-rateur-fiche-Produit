"""Diagnostic LLM avec chunking"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from app.database import SessionLocal
from app.models.document import Document
from app.services.fiche_direct_service import (
    _build_documents_context, _read_template_item_list,
    _call_llm_for_sheet, CHUNK_SIZE
)
from app.services.ai_service import set_active_provider

set_active_provider("anthropic")

db = SessionLocal()
docs = db.query(Document).filter(Document.id.in_([8, 9])).all()
ctx = _build_documents_context(docs)
print(f"Context: {len(ctx)} chars")

items = _read_template_item_list()
pt_fields = items.get("Produit Technique", [])
print(f"Produit Technique: {len(pt_fields)} champs -> {(len(pt_fields)-1)//CHUNK_SIZE + 1} chunks")

result = _call_llm_for_sheet("Produit Technique", "", ctx, template_fields=pt_fields)
fields = result.get("fields", [])
print(f"Champs retournes: {len(fields)}")
if result.get("error"):
    print(f"ERREUR: {result['error']}")
filled = [f for f in fields if f.get("value") and f.get("value") != "Information manquante"]
print(f"Champs renseignes: {len(filled)}")
if filled:
    f = filled[0]
    print(f"Exemple: {f.get('parameter')} = {f.get('value')} ({f.get('confidence_pct')}%)")

db.close()
