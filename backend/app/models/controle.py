from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class ConformiteStatus(str):
    CONFORME = "Conforme"
    ECART = "Écart"
    MANQUANT = "Manquant"
    SUPPLEMENTAIRE = "Supplémentaire"
    NON_CONTROLABLE = "Non contrôlable"


class Controle(Base):
    __tablename__ = "controles"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product = relationship("Product", back_populates="controles")

    livraison_version = Column(String(50))
    livraison_date = Column(DateTime(timezone=True))
    livraison_document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)

    # Résumé
    total_rules = Column(Integer, default=0)
    conformes = Column(Integer, default=0)
    ecarts = Column(Integer, default=0)
    manquants = Column(Integer, default=0)
    supplementaires = Column(Integer, default=0)
    non_controlables = Column(Integer, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ControleDetail(Base):
    __tablename__ = "controle_details"

    id = Column(Integer, primary_key=True, index=True)
    controle_id = Column(Integer, ForeignKey("controles.id"), nullable=False)

    module = Column(String(100))
    rule_name = Column(String(500))
    expected_value = Column(Text)
    obtained_value = Column(Text)
    status = Column(String(50))  # Conforme, Écart, Manquant, Supplémentaire, Non contrôlable
    criticite = Column(String(20))  # Critique, Majeure, Mineure

    source_document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    source_page = Column(Integer)
    justification = Column(Text)
    ai_comment = Column(Text)

    # Régression vs version précédente
    is_regression = Column(String(10), default="Non")  # Oui, Non, Nouveau
    previous_status = Column(String(50))
