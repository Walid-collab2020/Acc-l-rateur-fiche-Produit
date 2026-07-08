from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class ArtifactType(str):
    REFERENTIEL = "Referentiel"
    FICHE = "Fiche"
    PARAMETRAGE = "Parametrage"
    LIVRAISON = "Livraison"
    RECETTE = "Recette"


class Version(Base):
    __tablename__ = "versions"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product = relationship("Product", back_populates="versions")

    artifact_type = Column(String(50))  # Referentiel, Fiche, Parametrage, Livraison, Recette
    version_number = Column(Integer, nullable=False)
    version_label = Column(String(20))  # V1, V2, V3...

    snapshot = Column(JSON)  # Snapshot complet des données à ce moment
    changes_from_previous = Column(JSON)  # Diff vs version précédente

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(String(200))
    reason = Column(Text)
    file_path = Column(String(1000))  # Export Excel archivé
    document_ids = Column(Text)       # JSON array of document IDs used to generate this version
    doc_stats = Column(Text)          # JSON: per-document extraction stats (items, coverage, empty domains)
