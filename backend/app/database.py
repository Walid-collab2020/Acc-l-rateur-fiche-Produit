from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},  # SQLite only
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app.models import document, product, referentiel, fiche, parametrage, atelier, controle, recette, version, fiche_direct, recette_history, nonreg_history, conformite_history  # noqa
    # ensure FicheItemHistory is registered
    from app.models.fiche_direct import FicheItemHistory  # noqa
    Base.metadata.create_all(bind=engine)
    from sqlalchemy import text
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE referentiel_items ADD COLUMN source_document_ids TEXT",
            "ALTER TABLE referentiel_items ADD COLUMN conflict BOOLEAN DEFAULT 0",
            "ALTER TABLE fiche_items ADD COLUMN sheet VARCHAR(100)",
            "ALTER TABLE fiche_items ADD COLUMN section VARCHAR(200)",
            "ALTER TABLE fiche_items ADD COLUMN parameter VARCHAR(500)",
            "ALTER TABLE fiche_items ADD COLUMN valeurs_possibles TEXT",
            "ALTER TABLE fiche_items ADD COLUMN kelia_comment TEXT",
            "ALTER TABLE fiche_items ADD COLUMN value TEXT",
            "ALTER TABLE fiche_items ADD COLUMN source_document_ids TEXT",
            "ALTER TABLE fiche_items ADD COLUMN source_paragraph TEXT",
            "ALTER TABLE fiche_items ADD COLUMN source_citation TEXT",
            "ALTER TABLE fiche_items ADD COLUMN conflict BOOLEAN DEFAULT 0",
            "ALTER TABLE fiche_items DROP COLUMN rule_name",
            "ALTER TABLE fiche_items ADD COLUMN cr_override BOOLEAN DEFAULT 0",
            "ALTER TABLE versions ADD COLUMN document_ids TEXT",
            # Traçabilité complète fiche_direct_items
            "ALTER TABLE fiche_direct_items ADD COLUMN confidence_pct INTEGER",
            "ALTER TABLE fiche_direct_items ADD COLUMN justification TEXT",
            "ALTER TABLE fiche_direct_items ADD COLUMN reasoning TEXT",
            "ALTER TABLE fiche_direct_items ADD COLUMN source_extract TEXT",
            "ALTER TABLE fiche_direct_items ADD COLUMN hypotheses TEXT",
            "ALTER TABLE fiche_direct_items ADD COLUMN contradiction_detail TEXT",
            # Correction métier
            "ALTER TABLE fiche_direct_items ADD COLUMN user_value TEXT",
            "ALTER TABLE fiche_direct_items ADD COLUMN user_comment TEXT",
            "ALTER TABLE fiche_direct_items ADD COLUMN user_status VARCHAR(30)",
            # Annotations recette & non-régression
            "ALTER TABLE recette_history ADD COLUMN annotations_json TEXT",
            "ALTER TABLE nonreg_history ADD COLUMN annotations_json TEXT",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass
