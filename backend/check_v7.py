import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from app.database import SessionLocal
from sqlalchemy import text
import json

db = SessionLocal()
NO_VAL = "Information manquante"

# V7 content
rows = db.execute(text(
    "SELECT sheet, COUNT(*) as total, "
    "SUM(CASE WHEN value IS NOT NULL AND value != :nv THEN 1 ELSE 0 END) as filled "
    "FROM fiche_direct_items WHERE product_id=3 AND version_number=7 GROUP BY sheet"
), {"nv": NO_VAL}).fetchall()
print("V7 contenu:")
for r in rows:
    print(f"  {r[0]}: {r[2]}/{r[1]}")

if not rows:
    print("  (aucun item en V7)")

# Version record
v = db.execute(text(
    "SELECT version_number, created_at, document_ids, snapshot FROM versions "
    "WHERE product_id=3 AND artifact_type='FicheDirect' AND version_number=7"
)).fetchone()
if v:
    snap = json.loads(v[3]) if v[3] else {}
    print(f"Version: {v[0]} at {v[1]} docs={v[2]}")
    print(f"Errors: {snap.get('sheet_errors', {})}")
    print(f"Sheets in snapshot: {snap.keys()}")
else:
    print("Pas de version 7 dans la table versions")

# Quelques exemples remplis
examples = db.execute(text(
    "SELECT sheet, parameter, value, confidence_pct FROM fiche_direct_items "
    "WHERE product_id=3 AND version_number=7 AND value IS NOT NULL AND value != :nv LIMIT 5"
), {"nv": NO_VAL}).fetchall()
if examples:
    print("\nExemples remplis V7:")
    for e in examples:
        print(f"  [{e[0]}] {e[1]} = {e[2][:80]} ({e[3]}%)")

db.close()
