import os
import shutil
import uuid
from pathlib import Path
from typing import Optional
from sqlalchemy.orm import Session
from app.config import settings
from app.models.document import Document, DocumentScope
from app.models.product import Product
from app.utils.text_extractor import extract_text
from app.services import ai_service


ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".txt"}


def save_uploaded_file(file_content: bytes, original_filename: str, scope: str, product_id: Optional[int] = None) -> str:
    """Save uploaded file to storage and return its path."""
    ext = Path(original_filename).suffix.lower()
    unique_name = f"{uuid.uuid4().hex}{ext}"

    if scope == DocumentScope.GENERIQUE:
        dest_dir = Path(settings.documents_dir) / "generique"
    else:
        if product_id:
            dest_dir = Path(settings.documents_dir) / "produits" / str(product_id)
        else:
            dest_dir = Path(settings.documents_dir) / "produits" / "pending"

    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / unique_name
    dest_path.write_bytes(file_content)
    return str(dest_path)


def get_mime_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    mime_map = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".txt": "text/plain",
    }
    return mime_map.get(ext, "application/octet-stream")


def process_document(db: Session, file_path: str, original_filename: str, scope: str, product_id: Optional[int] = None, uploaded_by: str = "") -> Document:
    """Create document record, extract text, and classify with AI."""
    mime_type = get_mime_type(original_filename)
    file_size = os.path.getsize(file_path)

    extracted_text, page_count = extract_text(file_path, mime_type)
    classification = ai_service.classify_document(extracted_text, original_filename)

    # Try to auto-link product from AI detection
    if not product_id and classification.get("detected_product_number"):
        boss_num = classification["detected_product_number"]
        product = db.query(Product).filter(Product.boss_number == boss_num).first()
        if product:
            product_id = product.id

    doc = Document(
        filename=Path(file_path).name,
        original_filename=original_filename,
        file_path=file_path,
        file_size=file_size,
        mime_type=mime_type,
        scope=scope,
        product_id=product_id,
        extracted_text=extracted_text,
        page_count=page_count,
        category=classification["category"],
        category_confirmed=False,
        ai_confidence=classification.get("confidence"),
        ai_summary=classification.get("summary"),
        ai_classification_reason=classification.get("reason"),
        uploaded_by=uploaded_by,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def confirm_classification(db: Session, document_id: int, category: str, product_id: Optional[int] = None) -> Document:
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise ValueError(f"Document {document_id} not found")
    doc.category = category
    doc.category_confirmed = True
    if product_id is not None:
        doc.product_id = product_id
    db.commit()
    db.refresh(doc)
    return doc


def get_documents(db: Session, product_id: Optional[int] = None, scope: Optional[str] = None, category: Optional[str] = None) -> list[Document]:
    query = db.query(Document)
    if product_id is not None:
        query = query.filter(Document.product_id == product_id)
    if scope:
        query = query.filter(Document.scope == scope)
    if category:
        query = query.filter(Document.category == category)
    return query.order_by(Document.created_at.desc()).all()


def delete_document(db: Session, document_id: int) -> bool:
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        return False
    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)
    db.delete(doc)
    db.commit()
    return True
