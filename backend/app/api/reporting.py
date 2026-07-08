from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.product import Product, ProductStatus
from app.models.document import Document
from app.models.referentiel import ReferentielItem
from app.models.recette import Anomalie

router = APIRouter(prefix="/reporting", tags=["Reporting"])


@router.get("/portfolio")
def portfolio_kpis(db: Session = Depends(get_db)):
    products = db.query(Product).filter(Product.active == True).all()
    total = len(products)

    def count_status(field, status):
        return sum(1 for p in products if getattr(p, field) == status)

    validated_fiches = count_status("status_fiche", ProductStatus.VALIDATED)
    validated_parametrage = count_status("status_parametrage", ProductStatus.VALIDATED)
    validated_recette = count_status("status_recette", ProductStatus.VALIDATED)

    open_anomalies = db.query(Anomalie).filter(Anomalie.status.in_(["Ouverte", "En analyse"])).count()

    product_details = []
    for p in products:
        doc_count = db.query(Document).filter(Document.product_id == p.id).count()
        rule_count = db.query(ReferentielItem).filter(ReferentielItem.product_id == p.id).count()
        product_details.append({
            "id": p.id,
            "boss_number": p.boss_number,
            "name": p.name,
            "document_count": doc_count,
            "rule_count": rule_count,
            "status_referentiel": p.status_referentiel,
            "status_fiche": p.status_fiche,
            "status_parametrage": p.status_parametrage,
            "status_recette": p.status_recette,
        })

    return {
        "kpis": {
            "total_products": total,
            "products_validated_fiche": validated_fiches,
            "products_validated_parametrage": validated_parametrage,
            "products_validated_recette": validated_recette,
            "open_anomalies": open_anomalies,
            "taux_fiche": round(validated_fiches / total, 2) if total > 0 else 0,
            "taux_parametrage": round(validated_parametrage / total, 2) if total > 0 else 0,
            "taux_recette": round(validated_recette / total, 2) if total > 0 else 0,
        },
        "products": product_details,
    }


@router.get("/documents")
def document_coverage(db: Session = Depends(get_db)):
    products = db.query(Product).filter(Product.active == True).all()
    result = []
    required_categories = [
        "Conditions Générales",
        "Note Technique Actuarielle",
        "Extraction BOSS",
        "Fiche Produit",
    ]
    for p in products:
        docs = db.query(Document).filter(Document.product_id == p.id).all()
        available = {d.category for d in docs}
        missing = [c for c in required_categories if c not in available]
        result.append({
            "product_id": p.id,
            "boss_number": p.boss_number,
            "name": p.name,
            "total_documents": len(docs),
            "available_categories": list(available),
            "missing_categories": missing,
            "completeness": round(len([c for c in required_categories if c in available]) / len(required_categories), 2),
        })
    return result


@router.get("/recette-stats")
def recette_stats(db: Session = Depends(get_db)):
    from app.models.recette_history import RecetteHistory
    products = db.query(Product).filter(Product.active == True).all()
    result = []
    for p in products:
        rows = (
            db.query(RecetteHistory)
            .filter(RecetteHistory.product_id == p.id)
            .order_by(RecetteHistory.created_at.desc())
            .all()
        )
        if not rows:
            continue
        latest = rows[0]
        nb_analyses = len(rows)
        avg_taux = round(sum(r.taux_conformite for r in rows) / nb_analyses, 1)
        result.append({
            "product_id": p.id,
            "boss_number": p.boss_number,
            "name": p.name or "",
            "nb_analyses": nb_analyses,
            "latest_taux": latest.taux_conformite,
            "latest_statut": latest.statut_global,
            "avg_taux": avg_taux,
        })
    return result


@router.get("/nonreg-stats")
def nonreg_stats(db: Session = Depends(get_db)):
    from app.models.nonreg_history import NonRegHistory
    products = db.query(Product).filter(Product.active == True).all()
    result = []
    for p in products:
        rows = (
            db.query(NonRegHistory)
            .filter(NonRegHistory.product_id == p.id)
            .order_by(NonRegHistory.created_at.desc())
            .all()
        )
        if not rows:
            continue
        latest = rows[0]
        nb_analyses = len(rows)
        avg_stable = round(sum(r.taux_stable for r in rows) / nb_analyses, 1)
        result.append({
            "product_id": p.id,
            "boss_number": p.boss_number,
            "name": p.name or "",
            "nb_analyses": nb_analyses,
            "latest_taux_stable": latest.taux_stable,
            "avg_taux_stable": avg_stable,
        })
    return result


@router.get("/fiche-stats")
def fiche_stats(db: Session = Depends(get_db)):
    from app.models.fiche_direct import FicheDirectItem
    from sqlalchemy import func
    products = db.query(Product).filter(Product.active == True).all()
    result = []
    for p in products:
        latest_version = (
            db.query(func.max(FicheDirectItem.version_number))
            .filter(FicheDirectItem.product_id == p.id)
            .scalar()
        )
        if not latest_version:
            result.append({
                "product_id": p.id, "boss_number": p.boss_number, "name": p.name or "",
                "version": None, "total": 0,
                "a_arbitrer_mh": 0, "valide_metier": 0, "voir_kapia": 0,
                "fiche_generated": False,
            })
            continue
        items = (
            db.query(FicheDirectItem)
            .filter(FicheDirectItem.product_id == p.id, FicheDirectItem.version_number == latest_version)
            .all()
        )
        total = len(items)
        result.append({
            "product_id": p.id, "boss_number": p.boss_number, "name": p.name or "",
            "version": latest_version,
            "total": total,
            "genere": sum(1 for i in items if (i.user_status or "genere") == "genere"),
            # a_arbitrer (ancien) + a_arbitrer_mh (nouveau) comptés ensemble
            "a_arbitrer_mh": sum(1 for i in items if i.user_status in ("a_arbitrer", "a_arbitrer_mh")),
            "valide_metier": sum(1 for i in items if i.user_status == "valide_metier"),
            "voir_kapia": sum(1 for i in items if i.user_status == "voir_kapia"),
            "fiche_generated": total > 0,
        })
    return result


@router.patch("/products/{product_id}/validate")
def validate_module(product_id: int, module: str, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    MODULE_FIELD = {
        "fiche": "status_fiche",
        "recette": "status_recette",
        "parametrage": "status_parametrage",
    }
    field = MODULE_FIELD.get(module)
    if not field:
        raise HTTPException(status_code=422, detail=f"Module inconnu : {module}")
    setattr(product, field, ProductStatus.VALIDATED)
    db.commit()
    return {"ok": True, "module": module, "product_id": product_id, "status": ProductStatus.VALIDATED}
