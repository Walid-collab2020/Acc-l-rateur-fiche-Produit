from sqlalchemy import Column, Integer, String, Text, DateTime, Float, Boolean, Enum, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.database import Base


class DocumentCategory(str, enum.Enum):
    CONDITIONS_GENERALES = "Conditions Générales"
    NOTE_TECHNIQUE = "Note Technique Actuarielle"
    NOTICE = "Notice"
    AVENANT = "Avenant"
    EXTRACTION_BOSS = "Extraction BOSS"
    FICHE_PRODUIT = "Fiche Produit"
    PARAMETRAGE_KELIA = "Paramétrage KELIA"
    CR_ATELIER = "Compte-rendu Atelier"
    DECISION_CONCEPTION = "Décision de conception"
    ARBITRAGE = "Arbitrage"
    DOCUMENTATION_COMPLEMENTAIRE = "Documentation complémentaire"
    AUTRES = "Autres"
    GENERIQUE = "Documentation Générique"


class DocumentScope(str, enum.Enum):
    GENERIQUE = "generique"
    PRODUIT = "produit"


DOCUMENT_CATEGORIES = [e.value for e in DocumentCategory]


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(500), nullable=False)
    original_filename = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)
    file_size = Column(Integer)
    mime_type = Column(String(100))
    scope = Column(String(20), default=DocumentScope.PRODUIT)

    # Classification
    category = Column(String(100))
    category_confirmed = Column(Boolean, default=False)
    ai_confidence = Column(Float)
    ai_summary = Column(Text)
    ai_classification_reason = Column(Text)

    # Product link
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product = relationship("Product", back_populates="documents")

    # Content
    extracted_text = Column(Text)
    page_count = Column(Integer)

    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    uploaded_by = Column(String(200))
