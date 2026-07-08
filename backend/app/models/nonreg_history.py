from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey
from app.database import Base


class NonRegHistory(Base):
    __tablename__ = "nonreg_history"

    id           = Column(Integer, primary_key=True, index=True)
    product_id   = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    filename_v1  = Column(String, nullable=False)
    filename_v2  = Column(String, nullable=False)
    provider     = Column(String, default="openai-gpt5")
    created_at   = Column(DateTime, default=datetime.utcnow)
    v1_rows      = Column(Integer, default=0)
    v2_rows      = Column(Integer, default=0)
    taux_stable  = Column(Float, default=0.0)
    result_json  = Column(Text, nullable=False)
    annotations_json = Column(Text, nullable=True)
