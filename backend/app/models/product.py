from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.database import Base


class ProductStatus(str, enum.Enum):
    NOT_STARTED = "Non démarré"
    IN_PROGRESS = "En cours"
    GENERATED = "Généré"
    VALIDATED = "Validé"
    REJECTED = "Rejeté"


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    boss_number = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(500))
    description = Column(Text)
    active = Column(Boolean, default=True)

    # Status par étape
    status_referentiel = Column(String(50), default=ProductStatus.NOT_STARTED)
    status_fiche = Column(String(50), default=ProductStatus.NOT_STARTED)
    status_parametrage = Column(String(50), default=ProductStatus.NOT_STARTED)
    status_recette = Column(String(50), default=ProductStatus.NOT_STARTED)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relations
    documents = relationship("Document", back_populates="product")
    referentiel_items = relationship("ReferentielItem", back_populates="product")
    fiche_items = relationship("FicheItem", back_populates="product")
    parametrage_items = relationship("ParametrageItem", back_populates="product")
    ateliers = relationship("Atelier", back_populates="product")
    controles = relationship("Controle", back_populates="product")
    recettes = relationship("Recette", back_populates="product")
    versions = relationship("Version", back_populates="product")
