from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.non_regression_service import (
    compare_parametrage_files,
    parse_file,
    save_nonreg_history,
    get_nonreg_history_list,
    get_nonreg_history_detail,
    export_nonreg_history_excel,
)

router = APIRouter(prefix="/non-regression", tags=["Non-régression"])


@router.post("/compare")
async def compare(
    file_v1: UploadFile = File(...),
    file_v2: UploadFile = File(...),
    provider: str = Form("openai-gpt5"),
    product_id: int = Form(...),
    db: Session = Depends(get_db),
):
    b1 = await file_v1.read()
    b2 = await file_v2.read()
    if not b1 or not b2:
        raise HTTPException(status_code=422, detail="Fichier(s) vide(s)")
    try:
        result = compare_parametrage_files(
            b1, file_v1.filename or "v1",
            b2, file_v2.filename or "v2",
            provider,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    history_id = save_nonreg_history(
        db, product_id,
        file_v1.filename or "v1",
        file_v2.filename or "v2",
        provider, result,
    )
    result["history_id"] = history_id
    return result


@router.get("/{product_id}/history")
def history_list(product_id: int, db: Session = Depends(get_db)):
    return get_nonreg_history_list(db, product_id)


@router.get("/history/{history_id}")
def history_detail(history_id: int, db: Session = Depends(get_db)):
    result = get_nonreg_history_detail(db, history_id)
    if not result:
        raise HTTPException(status_code=404, detail="Historique introuvable")
    return result


@router.get("/history/{history_id}/export")
def history_export(history_id: int, db: Session = Depends(get_db)):
    try:
        xlsx_bytes = export_nonreg_history_excel(db, history_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="nonreg_{history_id}.xlsx"'},
    )


@router.patch("/history/{history_id}/annotations")
def update_nonreg_annotations(history_id: int, body: dict, db: Session = Depends(get_db)):
    import json as _json
    from app.models.nonreg_history import NonRegHistory
    entry = db.get(NonRegHistory, history_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Historique introuvable")
    entry.annotations_json = _json.dumps(body, ensure_ascii=False)
    db.commit()
    return {"ok": True}


@router.post("/preview")
async def preview_parsing(file: UploadFile = File(...)):
    b = await file.read()
    if not b:
        raise HTTPException(status_code=422, detail="Fichier vide")
    try:
        rows = parse_file(b, file.filename or "file")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {
        "filename": file.filename,
        "total_rows": len(rows),
        "preview": rows[:10],
    }
