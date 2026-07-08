from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.conformite_service import (
    analyze_conformite,
    save_conformite_history,
    get_conformite_history_list,
    get_conformite_history_detail,
    export_conformite_history_excel,
)

router = APIRouter(prefix="/conformite", tags=["Conformité Contractuelle"])


@router.post("/analyze")
async def analyze(
    file_cg: UploadFile = File(...),
    provider: str = Form("openai-gpt5"),
    product_id: int = Form(...),
    fpp_version: int = Form(...),
    db: Session = Depends(get_db),
):
    b_cg = await file_cg.read()
    if not b_cg:
        raise HTTPException(status_code=422, detail="Fichier CG vide")
    try:
        result = analyze_conformite(
            db, product_id, fpp_version,
            b_cg, file_cg.filename or "cg",
            provider,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    history_id = save_conformite_history(
        db, product_id,
        file_cg.filename or "cg",
        fpp_version, provider, result,
    )
    result["history_id"] = history_id
    return result


@router.get("/{product_id}/history")
def history_list(product_id: int, db: Session = Depends(get_db)):
    return get_conformite_history_list(db, product_id)


@router.get("/history/{history_id}")
def history_detail(history_id: int, db: Session = Depends(get_db)):
    result = get_conformite_history_detail(db, history_id)
    if not result:
        raise HTTPException(status_code=404, detail="Historique introuvable")
    return result


@router.get("/history/{history_id}/export")
def history_export(history_id: int, db: Session = Depends(get_db)):
    try:
        xlsx_bytes = export_conformite_history_excel(db, history_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="conformite_{history_id}.xlsx"'},
    )
