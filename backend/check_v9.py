import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from app.database import SessionLocal
from sqlalchemy import text
import json

db = SessionLocal()
NO_VAL = "Information manquante"

for ver in [8, 9]:
    rows = db.execute(text(
        "SELECT sheet, COUNT(*) as total, "
        "SUM(CASE WHEN value IS NOT NULL AND value != :nv THEN 1 ELSE 0 END) as filled "
        "FROM fiche_direct_items WHERE product_id=3 AND version_number=:v GROUP BY sheet"
    ), {"nv": NO_VAL, "v": ver}).fetchall()
    print(f"V{ver}: {[f'{r[0]}: {r[2]}/{r[1]}' for r in rows]}")

    v = db.execute(text(
        "SELECT created_at, document_ids, snapshot FROM versions "
        "WHERE product_id=3 AND artifact_type='FicheDirect' AND version_number=:v"
    ), {"v": ver}).fetchone()
    if v:
        snap = json.loads(v[2]) if v[2] else {}
        print(f"  created={v[0]} docs={v[1]}")
        print(f"  errors={snap.get('sheet_errors', {})}")
        print(f"  understanding={snap.get('product_understanding','')[:100]}")

db.close()
