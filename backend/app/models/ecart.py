from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class EcartItem(Base):
    """Information détectée dans les documents sources mais absente du modèle FPP cible."""
    __tablename__ = "ecart_items"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product = relationship("Product")

    # Lié à une version de fiche (calculé lors du generate_fiche)
    fiche_version_number = Column(Integer, nullable=False)

    # L'information détectée
    rule_name = Column(String(500), nullable=False)
    rule_value = Column(Text)
    category = Column(String(100))

    # Localisation exacte dans le document source
    source_document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    source_document = relationship("Document")
    source_document_name = Column(String(500))   # nom fichier, dénormalisé pour affichage
    source_page = Column(Integer)
    source_section = Column(String(500))
    source_paragraph = Column(Text)              # citation exacte

    # Contexte de détection
    ecart_type = Column(String(50))              # UNMAPPED_RULE / EXTRA_INFO / CR_INFO
    ai_confidence = Column(Float)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DocReadingReport(Base):
    """Rapport de lecture documentaire généré avant/pendant l'extraction référentiel."""
    __tablename__ = "doc_reading_reports"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product = relationship("Product")

    # Lié à une version référentiel
    referentiel_version_number = Column(Integer, nullable=False)

    # Document analysé
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    document = relationship("Document")
    document_name = Column(String(500))
    document_type = Column(String(50))           # DOC, DOCX, PDF, XLSX, XLS

    # Statistiques de lecture
    file_size_bytes = Column(Integer)
    page_count = Column(Integer)
    section_count = Column(Integer)
    table_count = Column(Integer)
    paragraph_count = Column(Integer)
    char_count = Column(Integer)
    chunk_count = Column(Integer)
    token_estimate = Column(Integer)             # char_count / 4 (approximation)
    pct_read = Column(Float)                     # % du document effectivement passé au LLM

    # Résultat
    items_extracted = Column(Integer, default=0) # items bruts extraits de ce doc
    status = Column(String(30))                  # READ_COMPLETE / READ_PARTIAL / ERROR / SKIPPED
    error_message = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
