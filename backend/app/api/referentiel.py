from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import Optional, List
from pydantic import BaseModel
import json

from app.database import get_db
from app.models.referentiel import ReferentielItem
from app.models.version import Version
from app.services.referentiel_service import generate_referentiel, get_referentiel, export_referentiel_excel, update_referentiel_from_version

router = APIRouter(prefix="/referentiel", tags=["Référentiel"])


class ReferentielItemResponse(BaseModel):
    id: int
    category: Optional[str]
    subcategory: Optional[str]
    rule_name: str
    rule_value: Optional[str]
    rule_unit: Optional[str]
    source_document_id: Optional[int]
    source_page: Optional[int]
    source_paragraph: Optional[str]
    ai_confidence: Optional[float]
    ai_comment: Optional[str]
    version_number: int
    source_document_ids: Optional[str] = None
    conflict: Optional[bool] = None

    class Config:
        from_attributes = True


class GenerateRequest(BaseModel):
    document_ids: List[int]


class UpdateVersionRequest(BaseModel):
    base_version: int
    new_document_ids: List[int]


class UpdateItemRequest(BaseModel):
    rule_value: Optional[str] = None
    ai_comment: Optional[str] = None


@router.post("/{product_id}/generate")
def generate(product_id: int, body: GenerateRequest, db: Session = Depends(get_db)):
    import traceback
    import logging
    logger = logging.getLogger(__name__)
    try:
        items = generate_referentiel(db, product_id, body.document_ids)
        conflict_count = sum(1 for i in items if i.conflict)
        sourced_count = sum(1 for i in items if i.source_paragraph and i.source_paragraph != "Source non identifiée")
        pct_sourced = round(sourced_count / max(len(items), 1) * 100, 1)
        return {
            "message": f"{len(items)} règles extraites",
            "count": len(items),
            "conflict_count": conflict_count,
            "sourced_count": sourced_count,
            "pct_sourced": pct_sourced,
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Erreur génération référentiel produit {product_id}: {type(e).__name__}: {e}\n{tb}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.get("/{product_id}/versions")
def list_versions(product_id: int, db: Session = Depends(get_db)):
    """Return all referentiel versions from the Version table (deduplicated, most recent per version number)."""
    versions_raw = (
        db.query(Version)
        .filter(Version.product_id == product_id, Version.artifact_type == "Referentiel")
        .order_by(Version.version_number.desc(), Version.created_at.desc())
        .all()
    )
    # Deduplicate: keep first (= most recent) occurrence of each version_number
    seen: set[int] = set()
    versions = []
    for v in versions_raw:
        if v.version_number not in seen:
            seen.add(v.version_number)
            versions.append(v)

    result = []
    for v in versions:
        item_count = db.query(sqlfunc.count(ReferentielItem.id)).filter(
            ReferentielItem.product_id == product_id,
            ReferentielItem.version_number == v.version_number,
        ).scalar() or 0
        doc_ids: list[int] = []
        if v.document_ids:
            try:
                doc_ids = json.loads(v.document_ids)
            except Exception:
                pass
        doc_stats = {}
        if v.doc_stats:
            try:
                doc_stats = json.loads(v.doc_stats)
            except Exception:
                pass
        result.append({
            "version": v.version_number,
            "label": v.version_label or f"V{v.version_number}",
            "created_at": v.created_at.isoformat() if v.created_at else None,
            "item_count": item_count,
            "file_path": v.file_path,
            "document_ids": doc_ids,
            "doc_stats": doc_stats,
        })
    return result


@router.post("/{product_id}/update-version")
def update_version(product_id: int, body: UpdateVersionRequest, db: Session = Depends(get_db)):
    """Create a new referentiel version from a base version + new documents."""
    try:
        items = update_referentiel_from_version(db, product_id, body.base_version, body.new_document_ids)
        conflict_count = sum(1 for i in items if i.conflict)
        return {
            "message": f"{len(items)} règles extraites",
            "count": len(items),
            "conflict_count": conflict_count,
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.delete("/{product_id}/versions/{version_number}", status_code=204)
def delete_version(product_id: int, version_number: int, db: Session = Depends(get_db)):
    """Delete a referentiel version: removes all items and the Version record(s)."""
    items_deleted = db.query(ReferentielItem).filter(
        ReferentielItem.product_id == product_id,
        ReferentielItem.version_number == version_number,
    ).delete(synchronize_session=False)

    versions_deleted = db.query(Version).filter(
        Version.product_id == product_id,
        Version.artifact_type == "Referentiel",
        Version.version_number == version_number,
    ).delete(synchronize_session=False)

    if items_deleted == 0 and versions_deleted == 0:
        raise HTTPException(status_code=404, detail=f"Version V{version_number} introuvable")

    db.commit()
    return None


@router.get("/{product_id}", response_model=List[ReferentielItemResponse])
def list_referentiel(
    product_id: int,
    category: Optional[str] = None,
    conflict: Optional[bool] = None,
    version: Optional[int] = None,
    confidence_max: Optional[float] = None,
    source_doc_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    # If no version specified, use the latest from Version table
    if version is None:
        latest = db.query(Version).filter(
            Version.product_id == product_id,
            Version.artifact_type == "Referentiel",
        ).order_by(Version.version_number.desc()).first()
        if latest is None:
            return []
        version = latest.version_number

    items = db.query(ReferentielItem).filter(
        ReferentielItem.product_id == product_id,
        ReferentielItem.version_number == version,
    ).all()

    if category:
        items = [i for i in items if i.category == category]
    if conflict is not None:
        items = [i for i in items if bool(i.conflict) == conflict]
    if confidence_max is not None:
        items = [i for i in items if i.ai_confidence is None or i.ai_confidence < confidence_max]
    if source_doc_id is not None:
        filtered = []
        for item in items:
            if item.source_document_ids:
                try:
                    ids = json.loads(item.source_document_ids)
                    if source_doc_id in ids:
                        filtered.append(item)
                        continue
                except Exception:
                    pass
            if item.source_document_id == source_doc_id:
                filtered.append(item)
        items = filtered
    return items


@router.patch("/{product_id}/items/{item_id}")
def update_item(product_id: int, item_id: int, body: UpdateItemRequest, db: Session = Depends(get_db)):
    item = db.query(ReferentielItem).filter(ReferentielItem.id == item_id, ReferentielItem.product_id == product_id).first()
    if not item:
        raise HTTPException(404, "Règle introuvable")
    if body.rule_value is not None:
        item.rule_value = body.rule_value
    if body.ai_comment is not None:
        item.ai_comment = body.ai_comment
    db.commit()
    return {"id": item.id, "rule_value": item.rule_value}


@router.get("/{product_id}/export")
def export_excel(product_id: int, db: Session = Depends(get_db)):
    try:
        file_path = export_referentiel_excel(db, product_id)
        return FileResponse(file_path, filename=f"Referentiel_{product_id}.xlsx",
                            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    except ValueError as e:
        raise HTTPException(404, str(e))
