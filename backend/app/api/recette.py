from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.services.recette_service import (
    get_fpp_versions,
    compare_fpp_versions,
    parse_parametrage_file,
    compare_parametrage_vs_fpp,
    save_recette_history,
    get_recette_history_list,
    get_recette_history_detail,
    export_recette_history_excel,
    compare_two_parametrage_files,
)

router = APIRouter(prefix="/recette", tags=["Recette Paramétrage"])


@router.get("/{product_id}/versions")
def versions(product_id: int, db: Session = Depends(get_db)):
    return get_fpp_versions(db, product_id)


@router.get("/{product_id}/history")
def history_list(product_id: int, db: Session = Depends(get_db)):
    return get_recette_history_list(db, product_id)


@router.get("/history/{history_id}")
def history_detail(history_id: int, db: Session = Depends(get_db)):
    result = get_recette_history_detail(db, history_id)
    if not result:
        raise HTTPException(status_code=404, detail="Historique introuvable")
    return result


@router.get("/history/{history_id}/export")
def history_export(history_id: int, db: Session = Depends(get_db)):
    try:
        xlsx_bytes = export_recette_history_excel(db, history_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="recette_{history_id}.xlsx"'},
    )


@router.patch("/history/{history_id}/annotations")
def update_recette_annotations(history_id: int, body: dict, db: Session = Depends(get_db)):
    import json as _json
    from app.models.recette_history import RecetteHistory
    entry = db.get(RecetteHistory, history_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Historique introuvable")
    entry.annotations_json = _json.dumps(body, ensure_ascii=False)
    db.commit()
    return {"ok": True}


@router.post("/{product_id}/compare")
async def compare(
    product_id: int,
    fpp_version: int = Form(...),
    file: UploadFile = File(...),
    provider: str = Form("openai-gpt5"),
    db: Session = Depends(get_db),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="Fichier vide")

    try:
        kelia_rows = parse_parametrage_file(content, file.filename or "upload")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    result = compare_parametrage_vs_fpp(db, product_id, fpp_version, kelia_rows, provider)

    # Sauvegarde historique
    history_id = save_recette_history(
        db, product_id, fpp_version, file.filename or "upload", provider, result
    )
    result["history_id"] = history_id
    return result


@router.post("/{product_id}/nonreg")
async def nonreg_files(
    product_id: int,
    file1: UploadFile = File(...),
    file2: UploadFile = File(...),
    provider: str = Form("openai-gpt5"),
    db: Session = Depends(get_db),
):
    content1 = await file1.read()
    content2 = await file2.read()
    if not content1 or not content2:
        raise HTTPException(status_code=422, detail="Fichier(s) vide(s)")

    try:
        rows1 = parse_parametrage_file(content1, file1.filename or "fichier1")
        rows2 = parse_parametrage_file(content2, file2.filename or "fichier2")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return compare_two_parametrage_files(
        rows1, rows2,
        filename1=file1.filename or "Fichier 1",
        filename2=file2.filename or "Fichier 2",
        provider=provider,
    )
