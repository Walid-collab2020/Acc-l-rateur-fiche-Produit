from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pathlib import Path
from pydantic import BaseModel
from typing import Optional
import json

from app.database import get_db
from app.services.folder_sync_service import scan_folders, ALLOWED_EXTENSIONS
from app.services import document_service
from app.models.document import Document, DocumentScope
from app.config import settings
import traceback

router = APIRouter(prefix="/sync", tags=["Sync"])

_CONFIG_FILE = Path(settings.storage_dir) / "custom_config.json"


def _load_custom_config() -> dict:
    if _CONFIG_FILE.exists():
        try:
            return json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


class StoragePathRequest(BaseModel):
    storage_dir: str


@router.get("/storage-path")
def get_storage_path():
    cfg = _load_custom_config()
    custom = cfg.get("documents_dir")
    return {
        "storage_dir": cfg.get("storage_dir", settings.storage_dir),
        "documents_dir": custom or settings.documents_dir,
        "is_custom": custom is not None,
    }


@router.post("/storage-path")
def set_storage_path(body: StoragePathRequest):
    p = Path(body.storage_dir.strip())
    if not p.exists():
        raise HTTPException(status_code=400, detail=f"Chemin introuvable : {p}")
    config = {
        "storage_dir": str(p),
        "documents_dir": str(p / "documents"),
    }
    _CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CONFIG_FILE.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"storage_dir": str(p), "documents_dir": str(p / "documents"), "is_custom": True}


@router.delete("/storage-path")
def reset_storage_path():
    if _CONFIG_FILE.exists():
        _CONFIG_FILE.unlink()
    return {
        "storage_dir": settings.storage_dir,
        "documents_dir": settings.documents_dir,
        "is_custom": False,
    }


@router.get("/browse-folder")
async def browse_folder():
    """Open a native Windows folder picker in a thread so it doesn't block the server."""
    import asyncio

    def _open_dialog():
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.wm_attributes("-topmost", 1)
            folder = filedialog.askdirectory(title="Sélectionner le répertoire storage")
            root.destroy()
            return str(Path(folder)) if folder else None
        except Exception as e:
            return None

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _open_dialog)
    return {"path": result}


@router.post("/scan")
def sync_scan(db: Session = Depends(get_db)):
    """Scan storage folders, create missing products, import new documents, and generate referentiels."""
    cfg = _load_custom_config()
    custom_documents_dir = cfg.get("documents_dir")
    return scan_folders(db, custom_documents_dir=custom_documents_dir)


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
