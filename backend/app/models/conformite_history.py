from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey
from app.database import Base


class ConformiteHistory(Base):
    __tablename__ = "conformite_history"

    id                = Column(Integer, primary_key=True, index=True)
    product_id        = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    filename_kelia    = Column(String, nullable=False)
    filename_contract = Column(String, nullable=False)
    provider          = Column(String, default="openai-gpt5")
    created_at        = Column(DateTime, default=datetime.utcnow)
    kelia_params      = Column(Integer, default=0)
    score_conformite  = Column(Float, default=0.0)
    result_json       = Column(Text, nullable=False)
