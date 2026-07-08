from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
import json

from app.database import get_db
from app.models.product import Product
from app.models.document import Document
from app.models.referentiel import ReferentielItem
from app.services.ai_service import get_client
from app.config import settings

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    product_id: Optional[int] = None
    history: list[ChatMessage] = []


class ChatResponse(BaseModel):
    response: str


def _build_context(product_id: int, db: Session) -> str:
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        return ""

    docs = db.query(Document).filter(Document.product_id == product_id).all()

    # Get latest referentiel version
    max_version = (
        db.query(ReferentielItem.version_number)
        .filter(ReferentielItem.product_id == product_id)
        .order_by(ReferentielItem.version_number.desc())
        .first()
    )
    ref_items = []
    if max_version:
        ref_items = (
            db.query(ReferentielItem)
            .filter(
                ReferentielItem.product_id == product_id,
                ReferentielItem.version_number == max_version[0],
            )
            .all()
        )

    lines = [
        f"## Produit : BOSS {product.boss_number}" + (f" — {product.name}" if product.name else ""),
    ]
    if product.description:
        lines.append(f"Description : {product.description}")

    if docs:
        lines.append(f"\n## Documents ({len(docs)}) :")
        for d in docs:
            lines.append(f"- {d.original_filename} [{d.category or 'Non classé'}]")

    if ref_items:
        lines.append(f"\n## Référentiel produit ({len(ref_items)} règles, version {max_version[0]}) :")
        for item in ref_items[:80]:
            val = item.rule_value or "—"
            unit = f" {item.rule_unit}" if item.rule_unit else ""
            conflict = " ⚠ CONFLIT" if item.conflict else ""
            lines.append(f"- [{item.category}] {item.rule_name} : {val}{unit}{conflict}")

    return "\n".join(lines)


@router.post("/message", response_model=ChatResponse)
def chat_message(req: ChatRequest, db: Session = Depends(get_db)):
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="Clé Anthropic non configurée")

    system_prompt = """Tu es KELIA Assistant, un expert en migration de produits d'assurance-vie vers le système KELIA.
Tu aides les consultants Accenture à analyser les produits, comprendre les règles de gestion, et préparer le paramétrage KELIA.
Tu réponds en français, de façon concise et précise.
Si une information n'est pas dans le contexte fourni, dis-le clairement plutôt que d'inventer."""

    if req.product_id:
        context = _build_context(req.product_id, db)
        if context:
            system_prompt += f"\n\nContexte du produit sélectionné :\n{context}"

    history_messages = []
    for h in req.history[-10:]:
        history_messages.append({"role": h.role, "content": h.content})
    history_messages.append({"role": "user", "content": req.message})

    client = get_client()
    resp = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=1000,
        system=system_prompt,
        messages=history_messages,
    )
    return ChatResponse(response=resp.content[0].text.strip())
