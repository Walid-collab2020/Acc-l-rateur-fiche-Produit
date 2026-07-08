from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class FicheItem(Base):
    __tablename__ = "fiche_items"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product = relationship("Product", back_populates="fiche_items")

    # Versioning
    version_number = Column(Integer, default=1)

    # Template structure
    sheet = Column(String(100))          # Sheet name (e.g. "Produit Technique")
    section = Column(String(200))        # Section header within the sheet
    parameter = Column(String(500), nullable=False)  # Parameter name (col A)
    valeurs_possibles = Column(Text)     # Col C from template
    kelia_comment = Column(Text)         # Col D from template

    # Filled value
    value = Column(Text)

    # Source traceability
    source_document_ids = Column(Text)   # JSON array of source doc IDs
    source_document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    source_document = relationship("Document")
    source_paragraph = Column(Text)
    source_citation = Column(Text)

    # AI quality
    ai_confidence = Column(Float)
    ai_comment = Column(Text)
    conflict = Column(Boolean, default=False)
    cr_override = Column(Boolean, default=False)   # True when CR atelier value supersedes referentiel

    created_at = Column(DateTime(timezone=True), server_default=func.now())
