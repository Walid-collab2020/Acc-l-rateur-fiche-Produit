
import sqlite3, json
conn = sqlite3.connect("C:/Users/walid.ben.lamine/OneDrive - Accenture/01ApplicactionCartoProduit/storage/db/kelia.db")

# All versions with item counts
print("=== ALL VERSIONS ===")
vers = conn.execute("SELECT id, product_id, version_label, created_at FROM versions ORDER BY id").fetchall()
for v in vers:
    vid, pid, label, created = v
    count = conn.execute("SELECT COUNT(*) FROM referentiel_items WHERE version_number=?", (label,)).fetchone()[0]
    print(f"  Version ID={vid} | product_id={pid} | label={label} | items={count} | {created}")

# Check all referentiel items grouped by version
print("\n=== ALL ITEMS BY VERSION ===")
rows = conn.execute("SELECT version_number, COUNT(*) as cnt FROM referentiel_items GROUP BY version_number ORDER BY version_number").fetchall()
for r in rows:
    print(f"  {r[0]}: {r[1]} items")

# Check products
print("\n=== PRODUCTS ===")
products = conn.execute("SELECT id, name FROM products").fetchall()
for p in products:
    print(f"  Product ID={p[0]}: {p[1]}")

# Check if there's a latest version with items
print("\n=== LATEST VERSION WITH ITEMS ===")
row = conn.execute("SELECT version_number, COUNT(*) FROM referentiel_items GROUP BY version_number ORDER BY version_number DESC LIMIT 1").fetchone()
if row:
    vnum, cnt = row
    print(f"Version {vnum}: {cnt} items")
    items = conn.execute("SELECT category, rule_name, rule_value FROM referentiel_items WHERE version_number=? LIMIT 30", (vnum,)).fetchall()
    for i in items:
        print(f"  [{i[0]}] {i[1]} = {(i[2] or '')[:80]}")
