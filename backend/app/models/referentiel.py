from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class ReferentielItem(Base):
    __tablename__ = "referentiel_items"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product = relationship("Product", back_populates="referentiel_items")

    # Catégorie de la règle
    category = Column(String(100))  # versements, cotisations, garanties, etc.
    subcategory = Column(String(100))
    rule_name = Column(String(500), nullable=False)
    rule_value = Column(Text)
    rule_unit = Column(String(50))

    # Traçabilité documentaire
    source_document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    source_document = relationship("Document")
    source_page = Column(Integer)
    source_paragraph = Column(Text)

    # Multi-source deduplication
    source_document_ids = Column(Text)  # JSON array of all source doc IDs
    conflict = Column(Boolean, default=False)

    # Qualité IA
    ai_confidence = Column(Float)
    ai_comment = Column(Text)

    # Versioning
    version_number = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    created_by = Column(String(200))
