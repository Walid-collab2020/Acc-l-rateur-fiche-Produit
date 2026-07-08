from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import Optional, List
from pydantic import BaseModel
import json
from pathlib import Path

from app.database import get_db
from app.models.fiche import FicheItem
from app.models.ecart import EcartItem, DocReadingReport
from app.models.version import Version
from app.services.fiche_service import check_template, generate_fiche, export_fiche_excel

router = APIRouter(prefix="/fiches", tags=["Fiches Produit"])


# ── Pydantic Schemas ─────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    complementary_document_ids: List[int] = []
    referentiel_version: Optional[int] = None


class FicheItemResponse(BaseModel):
    id: int
    product_id: int
    version_number: int
    sheet: str
    section: Optional[str] = None
    parameter: str
    valeurs_possibles: Optional[str] = None
    kelia_comment: Optional[str] = None
    value: Optional[str] = None
    source_document_ids: Optional[str] = None
    source_document_id: Optional[int] = None
    source_paragraph: Optional[str] = None
    source_citation: Optional[str] = None
    ai_confidence: Optional[float] = None
    ai_comment: Optional[str] = None
    conflict: Optional[bool] = None
    cr_override: Optional[bool] = None

    class Config:
        from_attributes = True


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/check-template")
def check_template_endpoint():
    """Check whether the KELIA template Excel file is present."""
    return check_template()


@router.post("/{product_id}/generate")
def generate(product_id: int, body: GenerateRequest, db: Session = Depends(get_db)):
    """Generate a new version of the Fiche Produit KELIA for a product."""
    try:
        items = generate_fiche(db, product_id, complementary_document_ids=body.complementary_document_ids, referentiel_version=body.referentiel_version)
        conflict_count = sum(1 for i in items if i.conflict)
        real_count = sum(1 for i in items if i.value and i.value != "Aucune règle mentionnée dans les documents analysés")
        return {
            "message": f"{len(items)} champs générés, {real_count} renseignés",
            "count": len(items),
            "conflict_count": conflict_count,
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/{product_id}/versions")
def list_versions(product_id: int, db: Session = Depends(get_db)):
    """Return all Fiche versions for a product from the Version table."""
    versions = (
        db.query(Version)
        .filter(Version.product_id == product_id, Version.artifact_type == "Fiche")
        .order_by(Version.version_number.desc())
        .all()
    )

    result = []
    for v in versions:
        item_count = db.query(sqlfunc.count(FicheItem.id)).filter(
            FicheItem.product_id == product_id,
            FicheItem.version_number == v.version_number,
        ).scalar() or 0

        doc_ids: list[int] = []
        if v.document_ids:
            try:
                doc_ids = json.loads(v.document_ids)
            except Exception:
                pass

        snapshot = v.snapshot or {}
        result.append({
            "version": v.version_number,
            "label": v.version_label or f"V{v.version_number}",
            "created_at": v.created_at.isoformat() if v.created_at else None,
            "item_count": item_count,
            "document_ids": doc_ids,
            "referentiel_version": snapshot.get("referentiel_version"),
            "complementary_document_ids": snapshot.get("complementary_document_ids", []),
        })
    return result


@router.delete("/{product_id}/versions/{version_number}", status_code=204)
def delete_version(product_id: int, version_number: int, db: Session = Depends(get_db)):
    """Delete a fiche version: removes all items and the Version record(s)."""
    items_deleted = db.query(FicheItem).filter(
        FicheItem.product_id == product_id,
        FicheItem.version_number == version_number,
    ).delete(synchronize_session=False)

    versions_deleted = db.query(Version).filter(
        Version.product_id == product_id,
        Version.artifact_type == "Fiche",
        Version.version_number == version_number,
    ).delete(synchronize_session=False)

    if items_deleted == 0 and versions_deleted == 0:
        raise HTTPException(status_code=404, detail=f"Version V{version_number} introuvable")

    db.commit()
    return None


@router.get("/{product_id}", response_model=List[FicheItemResponse])
def list_fiches(
    product_id: int,
    sheet: Optional[str] = None,
    conflict: Optional[bool] = None,
    confidence_max: Optional[float] = None,
    version: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """List Fiche items for a product, optionally filtered."""
    # Determine version to use
    if version is None:
        max_ver = (
            db.query(sqlfunc.max(FicheItem.version_number))
            .filter(FicheItem.product_id == product_id)
            .scalar()
        )
        if max_ver is None:
            return []
        version = max_ver

    query = db.query(FicheItem).filter(
        FicheItem.product_id == product_id,
        FicheItem.version_number == version,
    )

    if sheet:
        query = query.filter(FicheItem.sheet == sheet)
    if conflict is not None:
        query = query.filter(FicheItem.conflict == conflict)
    if confidence_max is not None:
        query = query.filter(
            (FicheItem.ai_confidence == None) | (FicheItem.ai_confidence < confidence_max)  # noqa: E711
        )

    return query.all()


@router.get("/{product_id}/ecarts")
def list_ecarts(
    product_id: int,
    version: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """
    Return Écarts for a product: règles détectées dans les documents sources
    mais absentes du modèle FPP cible.
    """
    query = db.query(EcartItem).filter(EcartItem.product_id == product_id)
    if version is not None:
        query = query.filter(EcartItem.fiche_version_number == version)
    else:
        # latest fiche version
        max_ver = (
            db.query(sqlfunc.max(EcartItem.fiche_version_number))
            .filter(EcartItem.product_id == product_id)
            .scalar()
        )
        if max_ver is None:
            return []
        query = query.filter(EcartItem.fiche_version_number == max_ver)

    items = query.order_by(EcartItem.category, EcartItem.rule_name).all()
    return [
        {
            "id": e.id,
            "rule_name": e.rule_name,
            "rule_value": e.rule_value,
            "category": e.category,
            "source_document_name": e.source_document_name,
            "source_page": e.source_page,
            "source_section": e.source_section,
            "source_paragraph": e.source_paragraph,
            "ecart_type": e.ecart_type,
            "ai_confidence": e.ai_confidence,
        }
        for e in items
    ]


@router.get("/{product_id}/reading-report")
def get_reading_report(
    product_id: int,
    referentiel_version: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """
    Return document reading report for a referentiel version.
    Shows: pages, sections, tables, chars, chunks, % read, status per document.
    """
    query = db.query(DocReadingReport).filter(DocReadingReport.product_id == product_id)
    if referentiel_version is not None:
        query = query.filter(DocReadingReport.referentiel_version_number == referentiel_version)
    else:
        max_ver = (
            db.query(sqlfunc.max(DocReadingReport.referentiel_version_number))
            .filter(DocReadingReport.product_id == product_id)
            .scalar()
        )
        if max_ver is None:
            return []
        query = query.filter(DocReadingReport.referentiel_version_number == max_ver)

    reports = query.order_by(DocReadingReport.document_name).all()
    return [
        {
            "id": r.id,
            "document_name": r.document_name,
            "document_type": r.document_type,
            "file_size_bytes": r.file_size_bytes,
            "page_count": r.page_count,
            "section_count": r.section_count,
            "table_count": r.table_count,
            "paragraph_count": r.paragraph_count,
            "char_count": r.char_count,
            "chunk_count": r.chunk_count,
            "token_estimate": r.token_estimate,
            "pct_read": r.pct_read,
            "items_extracted": r.items_extracted,
            "status": r.status,
            "referentiel_version": r.referentiel_version_number,
        }
        for r in reports
    ]


@router.get("/{product_id}/export")
def export_excel(product_id: int, db: Session = Depends(get_db)):
    """Export the latest Fiche Produit to Excel."""
    try:
        file_path = export_fiche_excel(db, product_id)
        p = Path(file_path)
        return FileResponse(
            file_path,
            filename=p.name,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
