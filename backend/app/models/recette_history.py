from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime
from app.database import Base

class RecetteHistory(Base):
    __tablename__ = "recette_history"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, nullable=False, index=True)
    fpp_version = Column(Integer, nullable=False)
    filename_kelia = Column(String(500), nullable=True)
    provider = Column(String(50), default="openai-gpt5")
    created_at = Column(DateTime, default=datetime.utcnow)
    kelia_rows = Column(Integer, default=0)
    taux_conformite = Column(Integer, default=0)
    statut_global = Column(String(100), default="")
    result_json = Column(Text, nullable=False)
    annotations_json = Column(Text, nullable=True)
