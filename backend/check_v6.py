from app.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
NO_VAL = "Information manquante"
rows = db.execute(text(
    "SELECT sheet, COUNT(*) as total, "
    "SUM(CASE WHEN value IS NOT NULL AND value != :nv THEN 1 ELSE 0 END) as filled "
    "FROM fiche_direct_items WHERE product_id=3 AND version_number=6 GROUP BY sheet"
), {"nv": NO_VAL}).fetchall()
print("Sheet stats V6:")
for r in rows:
    print(f"  {r[0]}: {r[2]}/{r[1]}")

# Check a few filled examples
examples = db.execute(text(
    "SELECT sheet, parameter, value, confidence_pct FROM fiche_direct_items "
    "WHERE product_id=3 AND version_number=6 AND value IS NOT NULL AND value != :nv LIMIT 10"
), {"nv": NO_VAL}).fetchall()
print("\nExemples renseignes:")
for e in examples:
    print(f"  [{e[0]}] {e[1]} = {e[2]} ({e[3]}%)")

db.close()
