from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class AnomalieStatus(str):
    OUVERTE = "Ouverte"
    EN_ANALYSE = "En analyse"
    CORRIGEE = "Corrigée"
    RETESTEE = "Re-testée"
    VALIDEE = "Validée"
    REJETEE = "Rejetée"
    CLOTUREE = "Clôturée"


class Recette(Base):
    __tablename__ = "recettes"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product = relationship("Product", back_populates="recettes")
    controle_id = Column(Integer, ForeignKey("controles.id"), nullable=True)

    version = Column(String(50))
    recette_date = Column(DateTime(timezone=True), server_default=func.now())

    total_controls = Column(Integer, default=0)
    conformes = Column(Integer, default=0)
    ecarts = Column(Integer, default=0)
    regressions = Column(Integer, default=0)
    anomalies_critiques = Column(Integer, default=0)
    anomalies_majeures = Column(Integer, default=0)
    anomalies_mineures = Column(Integer, default=0)

    taux_conformite = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Anomalie(Base):
    __tablename__ = "anomalies"

    id = Column(Integer, primary_key=True, index=True)
    recette_id = Column(Integer, ForeignKey("recettes.id"), nullable=False)
    recette = relationship("Recette")

    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    version = Column(String(50))
    rule_name = Column(String(500))
    expected_value = Column(Text)
    obtained_value = Column(Text)

    source_document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    source_page = Column(Integer)

    status = Column(String(50), default="Ouverte")
    criticite = Column(String(20))  # Critique, Majeure, Mineure
    ai_comment = Column(Text)
    analyst_comment = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    closed_at = Column(DateTime(timezone=True))
    closed_by = Column(String(200))
