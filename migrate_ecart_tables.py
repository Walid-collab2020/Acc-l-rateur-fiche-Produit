"""
Migration : créer les tables ecart_items et doc_reading_reports.
Run : py migrate_ecart_tables.py
"""
import sqlite3

conn = sqlite3.connect("storage/db/kelia.db")

conn.execute("""
CREATE TABLE IF NOT EXISTS ecart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    fiche_version_number INTEGER NOT NULL,
    rule_name VARCHAR(500) NOT NULL,
    rule_value TEXT,
    category VARCHAR(100),
    source_document_id INTEGER REFERENCES documents(id),
    source_document_name VARCHAR(500),
    source_page INTEGER,
    source_section VARCHAR(500),
    source_paragraph TEXT,
    ecart_type VARCHAR(50),
    ai_confidence REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
""")

conn.execute("""
CREATE TABLE IF NOT EXISTS doc_reading_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    referentiel_version_number INTEGER NOT NULL,
    document_id INTEGER REFERENCES documents(id),
    document_name VARCHAR(500),
    document_type VARCHAR(50),
    file_size_bytes INTEGER,
    page_count INTEGER,
    section_count INTEGER,
    table_count INTEGER,
    paragraph_count INTEGER,
    char_count INTEGER,
    chunk_count INTEGER,
    token_estimate INTEGER,
    pct_read REAL,
    items_extracted INTEGER DEFAULT 0,
    status VARCHAR(30),
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
""")

conn.commit()
conn.close()
print("Tables ecart_items et doc_reading_reports créées.")
