from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class ParametrageItem(Base):
    __tablename__ = "parametrage_items"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product = relationship("Product", back_populates="parametrage_items")

    # Découpage KELIA
    module = Column(String(100))  # Produit, Supports, Garanties, Frais, Fiscalité...
    section = Column(String(200))
    rule_name = Column(String(500), nullable=False)
    rule_value_target = Column(Text)
    justification = Column(Text)
    mapping_origin = Column(Text)  # règle BOSS source

    source_document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    source_document = relationship("Document")
    source_page = Column(Integer)

    ai_confidence = Column(Float)
    ai_comment = Column(Text)

    version_number = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
