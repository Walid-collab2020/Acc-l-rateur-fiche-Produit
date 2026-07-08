from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from pathlib import Path

from app.database import get_db
from app.models.document import Document, DocumentCategory, DocumentScope, DOCUMENT_CATEGORIES
from app.services.document_service import (
    save_uploaded_file, process_document, confirm_classification,
    get_documents, delete_document, ALLOWED_EXTENSIONS
)
from app.utils.text_extractor import extract_text as do_extract_text

router = APIRouter(prefix="/documents", tags=["Documents"])


class DocumentResponse(BaseModel):
    id: int
    filename: str
    original_filename: str
    scope: str
    category: Optional[str]
    category_confirmed: bool
    ai_confidence: Optional[float]
    ai_summary: Optional[str]
    ai_classification_reason: Optional[str]
    product_id: Optional[int]
    file_size: Optional[int]
    page_count: Optional[int]
    mime_type: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


class ClassifyRequest(BaseModel):
    category: str
    product_id: Optional[int] = None


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    scope: str = Form(default=DocumentScope.PRODUIT),
    product_id: Optional[int] = Form(default=None),
    uploaded_by: str = Form(default=""),
    db: Session = Depends(get_db),
):
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Format non supporté: {ext}. Formats acceptés: {', '.join(ALLOWED_EXTENSIONS)}")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(400, "Fichier vide")

    file_path = save_uploaded_file(content, file.filename, scope, product_id)
    doc = process_document(db, file_path, file.filename, scope, product_id, uploaded_by)

    return DocumentResponse(
        id=doc.id,
        filename=doc.filename,
        original_filename=doc.original_filename,
        scope=doc.scope,
        category=doc.category,
        category_confirmed=doc.category_confirmed,
        ai_confidence=doc.ai_confidence,
        ai_summary=doc.ai_summary,
        ai_classification_reason=doc.ai_classification_reason,
        product_id=doc.product_id,
        file_size=doc.file_size,
        page_count=doc.page_count,
        mime_type=doc.mime_type,
        created_at=doc.created_at.isoformat() if doc.created_at else "",
    )


@router.get("/", response_model=List[DocumentResponse])
def list_documents(
    product_id: Optional[int] = None,
    scope: Optional[str] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
):
    docs = get_documents(db, product_id, scope, category)
    return [
        DocumentResponse(
            id=d.id,
            filename=d.filename,
            original_filename=d.original_filename,
            scope=d.scope,
            category=d.category,
            category_confirmed=d.category_confirmed,
            ai_confidence=d.ai_confidence,
            ai_summary=d.ai_summary,
            ai_classification_reason=d.ai_classification_reason,
            product_id=d.product_id,
            file_size=d.file_size,
            page_count=d.page_count,
            mime_type=d.mime_type,
            created_at=d.created_at.isoformat() if d.created_at else "",
        )
        for d in docs
    ]


@router.get("/categories")
def get_categories():
    return {"categories": DOCUMENT_CATEGORIES}


@router.get("/{document_id}", response_model=DocumentResponse)
def get_document(document_id: int, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(404, f"Document {document_id} introuvable")
    return DocumentResponse(
        id=doc.id,
        filename=doc.filename,
        original_filename=doc.original_filename,
        scope=doc.scope,
        category=doc.category,
        category_confirmed=doc.category_confirmed,
        ai_confidence=doc.ai_confidence,
        ai_summary=doc.ai_summary,
        ai_classification_reason=doc.ai_classification_reason,
        product_id=doc.product_id,
        file_size=doc.file_size,
        page_count=doc.page_count,
        mime_type=doc.mime_type,
        created_at=doc.created_at.isoformat() if doc.created_at else "",
    )


@router.patch("/{document_id}/classify")
def classify_document(document_id: int, body: ClassifyRequest, db: Session = Depends(get_db)):
    try:
        doc = confirm_classification(db, document_id, body.category, body.product_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"id": doc.id, "category": doc.category, "category_confirmed": doc.category_confirmed}


@router.get("/{document_id}/download")
def download_document(document_id: int, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(404, "Document introuvable")
    if not Path(doc.file_path).exists():
        raise HTTPException(404, "Fichier non trouvé sur le serveur")
    return FileResponse(doc.file_path, filename=doc.original_filename, media_type=doc.mime_type)


@router.delete("/{document_id}")
def remove_document(document_id: int, db: Session = Depends(get_db)):
    ok = delete_document(db, document_id)
    if not ok:
        raise HTTPException(404, "Document introuvable")
    return {"message": "Document supprimé"}


@router.post("/{document_id}/reextract")
def reextract_document(document_id: int, db: Session = Depends(get_db)):
    """Re-run text extraction on an already-uploaded document (e.g. after extractor update)."""
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(404, "Document introuvable")
    if not Path(doc.file_path).exists():
        raise HTTPException(404, "Fichier source introuvable sur le serveur")

    extracted_text, page_count = do_extract_text(doc.file_path, doc.mime_type or "")
    old_chars = len(doc.extracted_text or "")
    old_pages = doc.page_count or 0
    doc.extracted_text = extracted_text
    doc.page_count = page_count
    db.commit()

    return {
        "id": doc.id,
        "filename": doc.original_filename,
        "page_count": page_count,
        "chars": len(extracted_text),
        "previous": {"chars": old_chars, "page_count": old_pages},
        "has_page_markers": "--- PAGE " in extracted_text,
    }
