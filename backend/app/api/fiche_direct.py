from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import Optional, List
from pydantic import BaseModel
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

from app.database import get_db
from app.models.fiche_direct import FicheDirectItem
from app.models.version import Version
from app.services.fiche_direct_service import (
    analyze_and_fill_fpp,
    generate_fiche_direct,
    extract_rules_for_direct,
    fill_fiche_from_extracted,
    export_fiche_direct_excel,
    check_missing_document_types,
    list_template_versions,
    update_consigne_in_template,
    _get_tokens,
)
from app.models.fiche_direct import FicheExtraInfo, FicheItemHistory
from app.services.ai_service import set_active_provider
from app.models.document import Document

router = APIRouter(prefix="/fiche2", tags=["Fiche Produit 2"])


class GenerateDirectRequest(BaseModel):
    document_ids: List[int]
    provider: str = "openai"
    sheets: Optional[List[str]] = None  # None = tous les onglets
    template_filename: Optional[str] = None  # None = template principal


class UpdateConsigneBody(BaseModel):
    parameter: str
    sheet: str
    consigne: str
    create_template: bool = True


class FillFromExtractionRequest(BaseModel):
    extraction_version: int
    provider: str = "openai"


class FicheDirectItemResponse(BaseModel):
    id: int
    product_id: int
    version_number: int
    sheet: str
    section: Optional[str] = None
    parameter: str
    valeurs_possibles: Optional[str] = None
    kelia_comment: Optional[str] = None
    value: Optional[str] = None
    status: Optional[str] = None
    source_document_id: Optional[int] = None
    source_paragraph: Optional[str] = None
    source_citation: Optional[str] = None
    source_page: Optional[int] = None
    sources_json: Optional[str] = None
    ai_confidence: Optional[float] = None
    ai_comment: Optional[str] = None
    conflict: Optional[bool] = None
    # Traçabilité complète
    confidence_pct: Optional[int] = None
    justification: Optional[str] = None
    reasoning: Optional[str] = None
    source_extract: Optional[str] = None
    hypotheses: Optional[str] = None
    contradiction_detail: Optional[str] = None
    # Correction métier
    user_value: Optional[str] = None
    user_comment: Optional[str] = None
    user_status: Optional[str] = None

    class Config:
        from_attributes = True


class PatchItemBody(BaseModel):
    user_value: Optional[str] = None
    user_comment: Optional[str] = None
    user_status: Optional[str] = None   # "genere" | "a_arbitrer" | "valide_metier"


class BulkValidateBody(BaseModel):
    item_ids: List[int]
    user_status: str = "valide_metier"


@router.get("/template/versions")
def get_template_versions():
    """Liste les versions du template Excel FPP disponibles dans le dossier generique."""
    return list_template_versions()


@router.patch("/template/consigne")
def update_consigne(body: UpdateConsigneBody, db: Session = Depends(get_db)):
    """
    Met à jour globalement la consigne de saisie d'un paramètre (tous produits, toutes versions).
    Si create_template=true : archive le template actuel et met à jour le fichier principal.
    """
    updated_items = db.query(FicheDirectItem).filter(
        FicheDirectItem.parameter == body.parameter,
        FicheDirectItem.sheet == body.sheet,
    ).all()
    for item in updated_items:
        item.valeurs_possibles = body.consigne
    db.commit()

    template_version: Optional[str] = None
    if body.create_template:
        try:
            # Collecte TOUTES les consignes actuelles en base (pas seulement la courante)
            # afin que le nouveau template reflète l'ensemble des modifications accumulées.
            from sqlalchemy import tuple_ as sa_tuple
            rows = (
                db.query(
                    FicheDirectItem.sheet,
                    FicheDirectItem.parameter,
                    FicheDirectItem.valeurs_possibles,
                )
                .filter(
                    FicheDirectItem.valeurs_possibles.isnot(None),
                    FicheDirectItem.valeurs_possibles != "",
                )
                .distinct(FicheDirectItem.sheet, FicheDirectItem.parameter)
                .all()
            )
            all_consignes = [
                {"sheet": r.sheet, "parameter": r.parameter, "consigne": r.valeurs_possibles}
                for r in rows
            ]
            template_version = update_consigne_in_template(all_consignes)
        except Exception as e:
            logger.error(f"[consigne] Erreur mise à jour template : {e}")
            raise HTTPException(status_code=500, detail=f"Erreur mise à jour template : {e}")

    return {
        "updated_items": len(updated_items),
        "template_version": template_version,
    }


@router.post("/{product_id}/generate")
def generate(product_id: int, body: GenerateDirectRequest, db: Session = Depends(get_db)):
    """Génère la FPP complète — 4 appels LLM parallèles, prompt expert Actuaire/MOA."""
    try:
        set_active_provider(body.provider)
        items, warnings, version_number = analyze_and_fill_fpp(db, product_id, body.document_ids, body.sheets, body.template_filename)
        filled = sum(1 for i in items if i.value and i.value not in ("Information manquante", "Aucune regle mentionnee dans les documents analyses"))
        conflict_count = sum(1 for i in items if i.conflict)
        avg_confidence = (
            sum(i.confidence_pct for i in items if i.confidence_pct is not None)
            // max(1, sum(1 for i in items if i.confidence_pct is not None))
        ) if any(i.confidence_pct is not None for i in items) else None
        token_stats = _get_tokens()
        return {
            "message": f"{filled}/{len(items)} champs renseignés",
            "count": len(items),
            "filled_count": filled,
            "conflict_count": conflict_count,
            "avg_confidence_pct": avg_confidence,
            "warnings": warnings,
            "version_number": version_number,
            **token_stats,
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except BaseException as e:
        ename = type(e).__name__
        if ename in ("KeyboardInterrupt", "SystemExit"):
            raise
        logger.error(f"[generate] Erreur produit {product_id}: {ename}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"{ename}: {e}")


@router.post("/{product_id}/extract")
def extract(product_id: int, body: GenerateDirectRequest, db: Session = Depends(get_db)):
    """
    Etape 1 — Lit les documents et extrait les règles métier (LLM, ~3-7 min par doc).
    Stocke le résultat. Retourne l'extraction_version à passer à /fill.
    """
    try:
        set_active_provider(body.provider)
        extraction_version, warnings = extract_rules_for_direct(db, product_id, body.document_ids)
        return {
            "extraction_version": extraction_version,
            "warnings": warnings,
            "message": f"Extraction terminee : {extraction_version}",
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except BaseException as e:
        ename = type(e).__name__
        if ename in ("KeyboardInterrupt", "SystemExit"):
            raise
        logger.error(f"[extract] Erreur produit {product_id}: {ename}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"{ename}: {e}")


@router.post("/{product_id}/fill")
def fill(product_id: int, body: FillFromExtractionRequest, db: Session = Depends(get_db)):
    """
    Etape 2 — Remplit la FPP depuis une extraction déjà stockée (LLM, ~2-4 min).
    Passer l'extraction_version retourné par /extract.
    """
    try:
        set_active_provider(body.provider)
        items, warnings = fill_fiche_from_extracted(db, product_id, body.extraction_version)
        filled = sum(1 for i in items if i.value and i.value != "Aucune regle mentionnee dans les documents analyses")
        conflict_count = sum(1 for i in items if i.conflict)
        return {
            "message": f"{len(items)} champs generes, {filled} renseignes",
            "count": len(items),
            "filled_count": filled,
            "conflict_count": conflict_count,
            "warnings": warnings,
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except BaseException as e:
        ename = type(e).__name__
        if ename in ("KeyboardInterrupt", "SystemExit"):
            raise
        logger.error(f"[fill] Erreur produit {product_id}: {ename}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"{ename}: {e}")


@router.get("/{product_id}/check-documents")
def check_documents(product_id: int, document_ids: str, db: Session = Depends(get_db)):
    """
    Vérifie les types de documents sélectionnés et retourne les warnings.
    document_ids: comma-separated list of ints
    """
    try:
        ids = [int(x) for x in document_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(status_code=422, detail="document_ids invalides")
    docs = db.query(Document).filter(Document.id.in_(ids)).all()
    warnings = check_missing_document_types(docs)
    present = [{"id": d.id, "name": d.original_filename, "type": d.category or "Non classifie"} for d in docs]
    return {"documents": present, "warnings": warnings}


@router.get("/{product_id}/versions")
def list_versions(product_id: int, db: Session = Depends(get_db)):
    """Liste les versions Fiche Produit 2 d'un produit."""
    versions = (
        db.query(Version)
        .filter(Version.product_id == product_id, Version.artifact_type == "FicheDirect")
        .order_by(Version.version_number.desc())
        .all()
    )
    result = []
    for v in versions:
        item_count = db.query(sqlfunc.count(FicheDirectItem.id)).filter(
            FicheDirectItem.product_id == product_id,
            FicheDirectItem.version_number == v.version_number,
        ).scalar() or 0

        filled_count = db.query(sqlfunc.count(FicheDirectItem.id)).filter(
            FicheDirectItem.product_id == product_id,
            FicheDirectItem.version_number == v.version_number,
            FicheDirectItem.status != "Information manquante",
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
            "filled_count": filled_count,
            "document_ids": doc_ids,
            "warnings": snapshot.get("warnings", []),
            "ref_rules_count": snapshot.get("ref_rules_count", 0),
            "tokens_input": snapshot.get("tokens_input"),
            "tokens_output": snapshot.get("tokens_output"),
            "tokens_total": snapshot.get("tokens_total"),
        })
    return result


@router.delete("/{product_id}/versions/{version_number}", status_code=204)
def delete_version(product_id: int, version_number: int, db: Session = Depends(get_db)):
    items_deleted = db.query(FicheDirectItem).filter(
        FicheDirectItem.product_id == product_id,
        FicheDirectItem.version_number == version_number,
    ).delete(synchronize_session=False)
    versions_deleted = db.query(Version).filter(
        Version.product_id == product_id,
        Version.artifact_type == "FicheDirect",
        Version.version_number == version_number,
    ).delete(synchronize_session=False)
    if items_deleted == 0 and versions_deleted == 0:
        raise HTTPException(status_code=404, detail=f"Version V{version_number} introuvable")
    db.commit()
    return None


@router.get("/{product_id}/extra-info")
def get_extra_info(product_id: int, version: Optional[int] = None, db: Session = Depends(get_db)):
    """Paramètres orphelins et points ouverts détectés dans les documents mais absents du template FPP."""
    if version is None:
        max_ver = (
            db.query(sqlfunc.max(FicheDirectItem.version_number))
            .filter(FicheDirectItem.product_id == product_id)
            .scalar()
        )
        if max_ver is None:
            return []
        version = max_ver
    rows = (
        db.query(FicheExtraInfo)
        .filter(FicheExtraInfo.product_id == product_id, FicheExtraInfo.version_number == version)
        .all()
    )
    return [
        {
            "id": r.id,
            "parameter": r.parameter,
            "value": r.value,
            "source_document": r.source_document,
            "source_page": r.source_page,
            "source_extract": r.source_extract,
            "comment": r.comment,
            "recommendation": r.recommendation,
            "user_decision": r.user_decision,
            "is_open_point": r.is_open_point,
            "open_point_code": r.open_point_code,
            "open_point_impact": r.open_point_impact,
            "open_point_action": r.open_point_action,
        }
        for r in rows
    ]


@router.patch("/{product_id}/extra-info/{item_id}")
def update_extra_info_decision(
    product_id: int,
    item_id: int,
    body: dict,
    db: Session = Depends(get_db),
):
    """Met à jour la décision utilisateur sur un paramètre orphelin."""
    row = db.query(FicheExtraInfo).filter(
        FicheExtraInfo.id == item_id,
        FicheExtraInfo.product_id == product_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Item introuvable")
    decision = body.get("user_decision")
    if decision not in (None, "added", "ecart", "ignored"):
        raise HTTPException(status_code=422, detail="user_decision invalide")
    row.user_decision = decision
    db.commit()
    return {"id": row.id, "user_decision": row.user_decision}


@router.get("/{product_id}/unused-rules")
def get_unused_rules(product_id: int, version: Optional[int] = None, db: Session = Depends(get_db)):
    """Règles extraites des documents mais non mappées à un champ FPP."""
    if version is None:
        max_ver = (
            db.query(sqlfunc.max(FicheDirectItem.version_number))
            .filter(FicheDirectItem.product_id == product_id)
            .scalar()
        )
        if max_ver is None:
            return []
        version = max_ver

    v = db.query(Version).filter(
        Version.product_id == product_id,
        Version.artifact_type == "FicheDirect",
        Version.version_number == version,
    ).first()
    if not v:
        return []
    snapshot = v.snapshot or {}
    return snapshot.get("unused_rules", [])


@router.get("/{product_id}", response_model=List[FicheDirectItemResponse])
def list_items(
    product_id: int,
    sheet: Optional[str] = None,
    status: Optional[str] = None,
    confidence_max: Optional[float] = None,
    version: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Liste les champs Fiche Produit 2 d'un produit."""
    if version is None:
        max_ver = (
            db.query(sqlfunc.max(FicheDirectItem.version_number))
            .filter(FicheDirectItem.product_id == product_id)
            .scalar()
        )
        if max_ver is None:
            return []
        version = max_ver

    query = db.query(FicheDirectItem).filter(
        FicheDirectItem.product_id == product_id,
        FicheDirectItem.version_number == version,
    )
    if sheet:
        query = query.filter(FicheDirectItem.sheet == sheet)
    if status:
        query = query.filter(FicheDirectItem.status == status)
    if confidence_max is not None:
        query = query.filter(
            (FicheDirectItem.ai_confidence == None) | (FicheDirectItem.ai_confidence < confidence_max)  # noqa: E711
        )
    return query.all()


@router.patch("/{product_id}/item/{item_id}")
def patch_item(
    product_id: int,
    item_id: int,
    body: PatchItemBody,
    db: Session = Depends(get_db),
):
    """Correction manuelle d'un champ FPP + historisation."""
    item = db.query(FicheDirectItem).filter(
        FicheDirectItem.id == item_id,
        FicheDirectItem.product_id == product_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item introuvable")

    # Historise avant modification si une valeur change
    if body.user_value is not None or body.user_comment is not None or body.user_status is not None:
        hist = FicheItemHistory(
            item_id=item_id,
            user_value=body.user_value if body.user_value is not None else item.user_value,
            user_comment=body.user_comment if body.user_comment is not None else item.user_comment,
            user_status=body.user_status if body.user_status is not None else item.user_status,
        )
        db.add(hist)

    if body.user_value is not None:
        item.user_value = body.user_value if body.user_value.strip() else None
    if body.user_comment is not None:
        item.user_comment = body.user_comment if body.user_comment.strip() else None
    if body.user_status is not None:
        item.user_status = body.user_status

    db.commit()
    db.refresh(item)
    return {
        "id": item.id,
        "user_value": item.user_value,
        "user_comment": item.user_comment,
        "user_status": item.user_status,
    }


@router.post("/{product_id}/items/bulk-validate")
def bulk_validate(
    product_id: int,
    body: BulkValidateBody,
    db: Session = Depends(get_db),
):
    """Validation en masse de plusieurs champs."""
    if body.user_status not in ("genere", "a_arbitrer", "valide_metier"):
        raise HTTPException(status_code=422, detail="user_status invalide")
    items = db.query(FicheDirectItem).filter(
        FicheDirectItem.id.in_(body.item_ids),
        FicheDirectItem.product_id == product_id,
    ).all()
    for item in items:
        hist = FicheItemHistory(
            item_id=item.id,
            user_value=item.user_value,
            user_comment=item.user_comment,
            user_status=body.user_status,
        )
        db.add(hist)
        item.user_status = body.user_status
    db.commit()
    return {"updated": len(items)}


@router.get("/{product_id}/item/{item_id}/history")
def item_history(
    product_id: int,
    item_id: int,
    db: Session = Depends(get_db),
):
    """Historique des corrections sur un champ."""
    item = db.query(FicheDirectItem).filter(
        FicheDirectItem.id == item_id,
        FicheDirectItem.product_id == product_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item introuvable")
    rows = (
        db.query(FicheItemHistory)
        .filter(FicheItemHistory.item_id == item_id)
        .order_by(FicheItemHistory.changed_at.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "user_value": r.user_value,
            "user_comment": r.user_comment,
            "user_status": r.user_status,
            "changed_at": r.changed_at.isoformat() if r.changed_at else None,
        }
        for r in rows
    ]


@router.get("/{product_id}/export")
def export_excel(product_id: int, db: Session = Depends(get_db)):
    """Export Excel de la Fiche Produit 2 dans le template FPP."""
    try:
        file_path = export_fiche_direct_excel(db, product_id)
        p = Path(file_path)
        return FileResponse(
            file_path,
            filename=p.name,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
