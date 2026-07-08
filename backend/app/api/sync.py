from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pathlib import Path
from app.database import get_db
from app.services.folder_sync_service import scan_folders, ALLOWED_EXTENSIONS
from app.services import document_service
from app.models.document import Document, DocumentScope
from app.config import settings
import traceback

router = APIRouter(prefix="/sync", tags=["Sync"])


@router.post("/scan")
def sync_scan(db: Session = Depends(get_db)):
    """Scan storage folders, create missing products, import new documents, and generate referentiels."""
    return scan_folders(db)


@router.get("/debug")
def sync_debug(db: Session = Depends(get_db)):
    """Debug endpoint: test extraction for each file in produits/650."""
    folder = Path(settings.documents_dir) / "produits" / "650"
    results = []
    for fp in sorted(folder.iterdir()):
        if not fp.is_file() or fp.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue
        existing = db.query(Document).filter(Document.file_path == str(fp)).first()
        entry = {"file": fp.name, "in_db": existing is not None}
        if existing:
            entry["chars"] = len(existing.extracted_text or "")
            entry["category"] = existing.category
            entry["confidence"] = existing.ai_confidence
        else:
            try:
                from app.utils.text_extractor import extract_text
                mime = document_service.get_mime_type(fp.name)
                text, pages = extract_text(str(fp), mime)
                entry["extracted_chars"] = len(text)
                entry["pages"] = pages
                entry["extraction_ok"] = len(text) > 50
            except Exception as e:
                entry["extraction_error"] = str(e)
                entry["traceback"] = traceback.format_exc()
        results.append(entry)
    return {"files": results}
