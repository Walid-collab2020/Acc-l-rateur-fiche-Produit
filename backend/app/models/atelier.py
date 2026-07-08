from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Atelier(Base):
    __tablename__ = "ateliers"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product = relationship("Product", back_populates="ateliers")

    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    document = relationship("Document")

    atelier_type = Column(String(100))  # CR Atelier Métier, CR Atelier KAPIA, Arbitrage...
    atelier_date = Column(DateTime(timezone=True))
    summary = Column(Text)

    detected_changes = Column(JSON)  # liste des modifications détectées
    impacts = Column(JSON)  # impacts sur référentiel, fiche, paramétrage

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ModificationJournal(Base):
    __tablename__ = "modification_journal"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    atelier_id = Column(Integer, ForeignKey("ateliers.id"), nullable=True)

    modification_date = Column(DateTime(timezone=True), server_default=func.now())
    author = Column(String(200))
    source = Column(String(500))
    object_modified = Column(String(500))  # référentiel / fiche / paramétrage
    object_id = Column(Integer)
    old_value = Column(Text)
    new_value = Column(Text)
    reason = Column(Text)
