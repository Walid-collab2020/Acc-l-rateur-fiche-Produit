import logging
from pathlib import Path
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session

from app.config import settings
from app.models.document import Document, DocumentScope
from app.models.product import Product
from app.services import document_service, ai_service
from app.utils.text_extractor import extract_text

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = document_service.ALLOWED_EXTENSIONS


def scan_folders(db: Session, custom_documents_dir: str | None = None) -> dict:
    """
    Scan storage/documents folders and sync with the database.
    - Creates products from produits/ subfolders (boss_number = folder name)
    - Imports new documents found in each folder
    - Creates Output/ subfolders automatically
    - Generates referentiel Markdown for products with new documents
    """
    documents_dir = custom_documents_dir or settings.documents_dir
    produits_dir = Path(documents_dir) / "produits"
    generique_dir = Path(documents_dir) / "generique"

    produits_dir.mkdir(parents=True, exist_ok=True)
    generique_dir.mkdir(parents=True, exist_ok=True)

    products_created = []
    docs_imported = []
    errors = []
    products_with_new_docs: set[int] = set()

    # Scan each subfolder in produits/ — folder name = BOSS number
    for folder in sorted(produits_dir.iterdir()):
        if not folder.is_dir() or folder.name in ("pending",):
            continue

        boss_number = folder.name

        # Create product if it doesn't exist yet
        product = db.query(Product).filter(Product.boss_number == boss_number).first()
        if not product:
            try:
                product = Product(
                    boss_number=boss_number,
                    name=None,         # défini manuellement par l'utilisateur après sync
                    description=None,
                )
                db.add(product)
                db.commit()
                db.refresh(product)
                products_created.append(boss_number)
                logger.info(f"Produit créé : BOSS {boss_number}")
            except Exception as e:
                db.rollback()
                msg = f"Création produit BOSS {boss_number} échouée : {e}"
                logger.error(msg)
                errors.append(msg)
                continue  # passe au dossier suivant

        # Ensure Output/ subfolder exists
        output_dir = folder / "Output"
        output_dir.mkdir(exist_ok=True)

        # Import new files from the product folder
        new_docs, import_errors = _import_new_files(db, folder, DocumentScope.PRODUIT, product.id)
        if new_docs:
            docs_imported.extend(new_docs)
            products_with_new_docs.add(product.id)
        errors.extend(import_errors)

    # Scan generique/ folder
    new_generic, generic_errors = _import_new_files(db, generique_dir, DocumentScope.GENERIQUE, None)
    docs_imported.extend(new_generic)
    errors.extend(generic_errors)

    # Generate referentiel documents for products that received new files
    referentiels_generated = []
    for product_id in products_with_new_docs:
        product = db.query(Product).filter(Product.id == product_id).first()
        if product:
            try:
                output_dir = produits_dir / product.boss_number / "Output"
                output_dir.mkdir(exist_ok=True)
                ref_path = _generate_referentiel_document(db, product, output_dir)
                if ref_path:
                    referentiels_generated.append(product.boss_number)
            except Exception as e:
                msg = f"Référentiel BOSS {product.boss_number} non généré : {e}"
                logger.warning(msg)
                errors.append(msg)

    return {
        "products_created": products_created,
        "docs_imported": [d.original_filename for d in docs_imported],
        "referentiels_generated": referentiels_generated,
        "errors": errors,
    }


def _import_new_files(
    db: Session,
    folder: Path,
    scope: str,
    product_id: Optional[int],
) -> tuple[list[Document], list[str]]:
    """Import files from a folder that are not yet registered in the database."""
    import traceback
    new_docs = []
    errors = []

    for file_path in folder.iterdir():
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue

        # Skip if already in DB (by file path)
        existing = db.query(Document).filter(Document.file_path == str(file_path)).first()
        if existing:
            logger.debug(f"Déjà en base : {file_path.name}")
            continue

        logger.info(f"Import de : {file_path.name}")
        try:
            doc = document_service.process_document(
                db=db,
                file_path=str(file_path),
                original_filename=file_path.name,
                scope=scope,
                product_id=product_id,
                uploaded_by="folder_sync",
            )
            new_docs.append(doc)
            logger.info(f"Importé : {file_path.name} (chars={len(doc.extracted_text or '')})")
        except Exception as e:
            msg = f"{file_path.name}: {e}\n{traceback.format_exc()}"
            logger.error(f"Erreur import {file_path.name} : {e}")
            errors.append(msg)
            try:
                db.rollback()
            except Exception:
                pass

    return new_docs, errors


def _infer_product_info(folder: Path, boss_number: str) -> dict:
    """Read the first available document to infer product name and description via AI."""
    for file_path in sorted(folder.iterdir()):
        if not file_path.is_file() or file_path.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue
        try:
            from app.services.document_service import get_mime_type
            mime = get_mime_type(file_path.name)
            text, _ = extract_text(str(file_path), mime)
            if text and len(text.strip()) > 50:
                return ai_service.generate_product_info(text, boss_number)
        except Exception as e:
            logger.error(f"Erreur lecture {file_path.name} pour info produit : {e}")

    return {"name": f"Produit BOSS {boss_number}", "description": None}


def _generate_referentiel_document(db: Session, product: Product, output_dir: Path) -> Optional[str]:
    """Generate a Markdown referentiel document from all product documents and save it to Output/."""
    docs = db.query(Document).filter(
        Document.product_id == product.id,
        Document.scope == DocumentScope.PRODUIT,
    ).all()

    doc_texts = [
        {
            "filename": d.original_filename,
            "category": d.category or "Autres",
            "text": d.extracted_text or "",
        }
        for d in docs
        if d.extracted_text and len(d.extracted_text.strip()) > 50
    ]

    if not doc_texts:
        return None

    try:
        content = ai_service.generate_referentiel_document(
            boss_number=product.boss_number,
            product_name=product.name,
            doc_texts=doc_texts,
        )
        date_str = datetime.now().strftime("%Y%m%d_%H%M")
        filename = f"referentiel_produit_{product.boss_number}_{date_str}.md"
        file_path = output_dir / filename
        file_path.write_text(content, encoding="utf-8")
        logger.info(f"Référentiel généré : {file_path}")
        return str(file_path)
    except Exception as e:
        logger.error(f"Erreur génération référentiel BOSS {product.boss_number} : {e}")
        return None
