from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class FicheDirectItem(Base):
    __tablename__ = "fiche_direct_items"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product = relationship("Product")

    version_number = Column(Integer, default=1)

    # Structure template FPP
    sheet = Column(String(100))
    section = Column(String(200))
    parameter = Column(String(500), nullable=False)
    valeurs_possibles = Column(Text)
    kelia_comment = Column(Text)

    # Valeur extraite
    value = Column(Text)

    # Statut métier : Validé / À vérifier / Ambigu / Information manquante / Sources contradictoires
    status = Column(String(60), default="À vérifier")

    # Source primaire
    source_document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    source_document = relationship("Document")
    source_paragraph = Column(Text)
    source_citation = Column(Text)
    source_page = Column(Integer, nullable=True)

    # Toutes les sources JSON [{"doc": str, "text": str, "page": int|null}]
    sources_json = Column(Text)

    # Qualité IA (ancien système — conservé pour rétrocompat)
    ai_confidence = Column(Float)
    ai_comment = Column(Text)
    conflict = Column(Boolean, default=False)

    # Traçabilité complète (nouveau système)
    confidence_pct = Column(Integer, nullable=True)        # 0-100
    justification = Column(Text)
    reasoning = Column(Text)
    source_extract = Column(Text)
    hypotheses = Column(Text)
    contradiction_detail = Column(Text)

    # Correction métier (saisie manuelle par l'utilisateur)
    user_value = Column(Text, nullable=True)
    user_comment = Column(Text, nullable=True)
    user_status = Column(String(30), nullable=True)   # "genere" | "a_arbitrer" | "valide_metier"

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class FicheItemHistory(Base):
    """Historique des corrections manuelles sur un champ FPP."""
    __tablename__ = "fiche_item_history"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("fiche_direct_items.id"), nullable=False)
    user_value = Column(Text, nullable=True)
    user_comment = Column(Text, nullable=True)
    user_status = Column(String(30), nullable=True)
    changed_at = Column(DateTime(timezone=True), server_default=func.now())


class FicheExtraInfo(Base):
    """Paramètres présents dans les documents mais absents du template FPP — pour arbitrage."""
    __tablename__ = "fiche_extra_info"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    version_number = Column(Integer, default=1)

    parameter = Column(String(500))
    value = Column(Text)
    source_document = Column(String(500))
    source_page = Column(Integer, nullable=True)
    source_extract = Column(Text)
    comment = Column(Text)
    recommendation = Column(String(100))   # "Ajouter à la FPP" | "Créer écart KAPIA" | "À arbitrer"
    user_decision = Column(String(50), nullable=True)  # null | "added" | "ecart" | "ignored"

    # Pour les points ouverts
    is_open_point = Column(Boolean, default=False)
    open_point_code = Column(String(20), nullable=True)
    open_point_impact = Column(Text, nullable=True)
    open_point_action = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
