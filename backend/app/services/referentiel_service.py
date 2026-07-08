import re
import unicodedata
from pathlib import Path
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.document import Document, DocumentScope
from app.models.product import Product, ProductStatus
from app.models.referentiel import ReferentielItem
from app.models.ecart import DocReadingReport
from app.models.version import Version
from app.services import ai_service
from app.services.ai_service import NO_VALUE
from app.services.excel_service import export_referentiel
from app.services.excel_parametrage_extractor import (
    is_parametrage_excel,
    extract_from_parametrage_excel,
)
from app.config import settings
import json
import logging

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Quality-filter helpers
# ---------------------------------------------------------------------------

_NOISE_VALUE_PATTERNS = (
    "aucune règle mentionnée",
    "aucune règle",
    "non mentionné dans",
    "non trouvé dans",
    "non documenté",
    "aucun ",
    "néant",
)

_HORS_SCOPE_EUROS = {
    "arbitrages", "gestion_pilotee", "gestion_pilotée", "supports_uc",
    "garantie_plancher_uc", "ppb", "actes_de_gestion", "8.1b",
}


def _is_noise_value(val: str) -> bool:
    v = (val or "").strip().lower()
    return any(p in v for p in _NOISE_VALUE_PATTERNS)


def _detect_product_support(texts: list[str]) -> str:
    combined = " ".join(t[:2000] for t in texts[:3]).lower()
    has_uc = any(x in combined for x in ["unités de compte", "supports uc", "gestion pilotée", "unité de compte"])
    has_euros = any(x in combined for x in ["actif général", "fonds en euros", "actif general"])
    if has_uc and has_euros:
        return "mixte"
    return "uc" if has_uc else "euros"


def _filter_hors_scope(items: list[dict], support: str) -> list[dict]:
    if support == "uc":
        return items
    excluded = _HORS_SCOPE_EUROS if support == "euros" else {"ppb", "actes_de_gestion"}
    result = []
    for item in items:
        cat = (item.get("category") or "").lower().replace(" ", "_").replace("-", "_")
        if not any(ex in cat for ex in excluded):
            result.append(item)
    return result


def _quality_report(items: list[dict], product_id: int, version: int) -> dict:
    total = len(items)
    if total == 0:
        return {"total_items": 0, "warnings": ["Aucun item généré"]}

    no_source = sum(1 for i in items if not i.get("source_paragraph"))
    no_value = sum(1 for i in items if _is_noise_value(i.get("rule_value") or ""))
    low_conf = sum(1 for i in items if (i.get("ai_confidence") or 1.0) < 0.15)
    conflicts = sum(1 for i in items if i.get("conflict"))

    warnings = []

    rachat_items = [i for i in items if "rachat autorisé cas" in (i.get("rule_name") or "").lower()]
    if len(rachat_items) < 3:
        warnings.append(f"ALERTE : {len(rachat_items)} cas de rachat (attendu ≥ 3 pour Art.83)")

    pb_annuel = next((i for i in items if "taux pb annuel" in (i.get("rule_name") or "").lower()), None)
    pb_provisoire = next((i for i in items if "taux pb provisoire" in (i.get("rule_name") or "").lower()), None)
    if pb_annuel and pb_provisoire:
        if (pb_annuel.get("rule_value") or "").strip() == (pb_provisoire.get("rule_value") or "").strip():
            warnings.append("ERREUR PB : Taux annuel = Taux provisoire — confusion probable")
    if not pb_annuel:
        warnings.append("MANQUANT : Taux PB annuel non trouvé dans le référentiel")

    pct_sourced = round((total - no_source) / total * 100, 1)
    quality_score = max(0, round(100 - (no_source / total * 40) - (len(warnings) * 8) - (no_value / total * 15)))

    report = {
        "product_id": product_id, "version": version,
        "total_items": total, "items_without_source": no_source,
        "pct_sourced": pct_sourced, "conflicts": conflicts,
        "low_confidence_items": low_conf, "warnings": warnings,
        "quality_score": quality_score,
    }
    logger.info(
        f"[QUALITÉ V{version} produit {product_id}] Score={quality_score}/100 | "
        f"{total} items | {pct_sourced}% sourcés | {conflicts} conflits | "
        f"Alertes: {warnings if warnings else 'aucune'}"
    )
    return report


def _get_doc_ids(item: dict) -> list[int]:
    """Return all doc_ids for an item (handles source_document_ids JSON array)."""
    if item.get("source_document_ids"):
        try:
            return json.loads(item["source_document_ids"])
        except Exception:
            pass
    if item.get("source_document_id") is not None:
        return [item["source_document_id"]]
    if item.get("doc_id") is not None:
        return [item["doc_id"]]
    return []


def _norm_key(s: str) -> str:
    """
    Normalize a string for cross-document rule matching:
    lowercase, remove accents, collapse spaces, strip punctuation.
    Ex: "Délai paiement rachat" == "delai paiement rachat" == "Delai  Paiement  Rachat."
    """
    if not s:
        return ""
    # Remove accents
    nfkd = unicodedata.normalize("NFKD", s)
    no_accent = "".join(c for c in nfkd if not unicodedata.combining(c))
    # Lowercase, collapse spaces, strip trailing punctuation
    return re.sub(r"\s+", " ", no_accent.lower().strip(" .,;:"))


def _norm_category(cat: str) -> str:
    """
    Normalize category to its 8.x numeric prefix for robust cross-document grouping.
    Ex: "8.10 Rachat individuel" → "8.10"
        "8.10 Rachat" → "8.10"
        "Rachat" → "rachat" (fallback)
    """
    m = re.match(r"(8\.\d+)", (cat or "").strip())
    if m:
        return m.group(1)
    return _norm_key(cat)


def _deduplicate(raw_items: list[dict]) -> list[dict]:
    """
    Deduplicate raw items extracted from multiple documents.

    Input: list of dicts like:
        {"doc_id": int, "category": str, "rule_name": str, "rule_value": str, ...}

    Groups by (norm_category, norm_rule_name) — accent-insensitive, space-insensitive.
    - 1 unique value  → merge into one item, conflict=False, source_document_ids = all doc_ids
    - >1 unique values → one item per distinct value, conflict=True, source_document_ids = doc_ids for that value

    Returns list of dicts ready to be inserted as ReferentielItem.
    """
    groups: dict[tuple, list[dict]] = {}
    for item in raw_items:
        key = (
            _norm_category(item.get("category") or ""),
            _norm_key(item.get("rule_name") or ""),
        )
        groups.setdefault(key, []).append(item)

    result: list[dict] = []
    for (cat_key, name_key), group_items in groups.items():
        # Collect distinct values (normalised for comparison, keep first original for display)
        value_map: dict[str, dict] = {}  # normalised_value -> {"original": str, "doc_ids": list}
        for it in group_items:
            raw_val = it.get("rule_value")
            norm_val = (raw_val or "").strip().lower()
            if norm_val not in value_map:
                value_map[norm_val] = {"original": raw_val, "doc_ids": []}
            value_map[norm_val]["doc_ids"].append(it["doc_id"])

        # Pick a representative item (first) for shared metadata
        rep = group_items[0]

        # If some sources have real values, discard NO_VALUE entries (avoid false conflicts)
        real_values = {k: v for k, v in value_map.items() if k != NO_VALUE.strip().lower() and k != ""}
        if real_values:
            value_map = real_values

        if len(value_map) == 1:
            # All sources agree — merge
            entry = next(iter(value_map.values()))
            all_doc_ids = [it["doc_id"] for it in group_items]
            result.append({
                "category": rep.get("category"),
                "subcategory": rep.get("subcategory"),
                "rule_name": rep.get("rule_name"),
                "rule_value": entry["original"],
                "rule_unit": rep.get("rule_unit"),
                "source_document_id": rep.get("doc_id"),
                "source_document_ids": json.dumps(all_doc_ids),
                "conflict": False,
                "source_paragraph": rep.get("source_paragraph"),
                "source_page": rep.get("source_page"),
                "ai_confidence": rep.get("confidence"),
                "ai_comment": rep.get("comment"),
            })
        else:
            # Conflict — one item per distinct value
            for norm_val, entry in value_map.items():
                # Use the first doc that produced this value as primary source
                primary_doc_id = entry["doc_ids"][0]
                # Find matching raw item for this value to get source metadata
                matching = next(
                    (it for it in group_items if it.get("doc_id") == primary_doc_id),
                    rep,
                )
                result.append({
                    "category": rep.get("category"),
                    "subcategory": rep.get("subcategory"),
                    "rule_name": rep.get("rule_name"),
                    "rule_value": entry["original"],
                    "rule_unit": matching.get("rule_unit"),
                    "source_document_id": primary_doc_id,
                    "source_document_ids": json.dumps(entry["doc_ids"]),
                    "conflict": True,
                    "source_paragraph": matching.get("source_paragraph"),
                    "source_page": matching.get("source_page"),
                    "ai_confidence": matching.get("confidence"),
                    "ai_comment": matching.get("comment"),
                })

    return result


def _compute_reading_stats(doc: Document) -> dict:
    """
    Compute zero-LLM reading statistics for a document from its extracted text.
    Returns a dict with all stats needed to populate DocReadingReport.
    """
    text = doc.extracted_text or ""
    char_count = len(text)

    section_count = len(re.findall(r'=== SECTION : .+? ===', text))
    table_count = len(re.findall(r'\[Tableau \d+', text))
    paragraph_count = sum(1 for line in text.split('\n') if line.strip())
    page_markers = len(re.findall(r'--- PAGE \d+ ---', text))
    page_count = doc.page_count or max(1, page_markers)

    try:
        from app.services.bmad_agents import _SINGLE_SHOT_THRESHOLD, _CHUNK_SIZE, _CHUNK_OVERLAP
        if char_count <= _SINGLE_SHOT_THRESHOLD:
            chunk_count = 1
        else:
            effective = max(1, _CHUNK_SIZE - _CHUNK_OVERLAP)
            chunk_count = max(1, (char_count - _CHUNK_OVERLAP + effective - 1) // effective)
    except Exception:
        chunk_count = max(1, char_count // 11000)

    token_estimate = char_count // 4

    ext = (doc.file_path or "").rsplit(".", 1)[-1].lower() if doc.file_path else ""
    if ext in ("xlsx", "xls"):
        doc_type = "excel"
        status = "READ_COMPLETE" if char_count > 0 else "ERROR"
    elif char_count == 0:
        doc_type = ext or "unknown"
        status = "NOT_READ"
    else:
        doc_type = ext or "unknown"
        status = "READ_COMPLETE"

    return {
        "document_name": doc.original_filename,
        "document_type": doc_type.upper(),
        "file_size_bytes": doc.file_size,
        "page_count": page_count,
        "section_count": section_count,
        "table_count": table_count,
        "paragraph_count": paragraph_count,
        "char_count": char_count,
        "chunk_count": chunk_count,
        "token_estimate": token_estimate,
        "pct_read": 100.0 if char_count > 0 else 0.0,
        "status": status,
    }


def generate_referentiel(db: Session, product_id: int, document_ids: list[int]) -> list[ReferentielItem]:
    """Generate referentiel by extracting data from provided documents."""
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise ValueError(f"Product {product_id} not found")

    # Determine next version number from the Version table (single source of truth)
    last_ver = db.query(Version).filter(
        Version.product_id == product_id,
        Version.artifact_type == "Referentiel",
    ).order_by(Version.version_number.desc()).first()
    next_version = (last_ver.version_number + 1) if last_ver else 1

    # Collect raw items from all documents
    raw_items: list[dict] = []
    doc_texts_for_support: list[str] = []  # B2: collect texts for support detection
    per_doc_stats: dict[int, dict] = {}  # doc_id → extraction stats
    reading_stats: dict[int, dict] = {}   # doc_id → reading report stats
    for doc_id in document_ids:
        doc = db.query(Document).filter(Document.id == doc_id, Document.product_id == product_id).first()
        if not doc:
            continue

        # Detect structured parametrage Excel → extraction directe, pas d'IA
        is_excel = doc.mime_type in (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel",
        ) or Path(doc.file_path).suffix.lower() in (".xlsx", ".xls")

        # Compute reading stats (zero-LLM, from extracted text structure)
        r_stats = _compute_reading_stats(doc)
        reading_stats[doc_id] = r_stats

        if is_excel and doc.file_path and Path(doc.file_path).exists() and is_parametrage_excel(doc.file_path):
            logger.info(f"[referentiel] Doc {doc_id} '{doc.original_filename}': fiche paramétrage détectée → extraction directe")
            extracted = extract_from_parametrage_excel(doc.file_path, doc.original_filename)
            # B5: normalize categories for Excel-extracted items
            from app.services.bmad_agents import _canonicalize_category
            for item in extracted:
                item["category"] = _canonicalize_category(item.get("category", ""))
            reading_stats[doc_id]["status"] = "READ_COMPLETE"
        else:
            if not doc.extracted_text:
                logger.warning(f"[referentiel] Doc {doc_id} '{doc.original_filename}': pas de texte extrait, ignoré")
                reading_stats[doc_id]["status"] = "NOT_READ"
                continue
            # B2: collect text for support detection
            if doc.extracted_text:
                doc_texts_for_support.append(doc.extracted_text)
            extracted = ai_service.extract_referentiel(doc.extracted_text, product.boss_number, doc.original_filename)

        for item_data in extracted:
            item_data["doc_id"] = doc_id
            raw_items.append(item_data)

        reading_stats[doc_id]["items_extracted"] = len(extracted)

        # Track per-doc stats
        from pathlib import Path as _Path
        ext = _Path(doc.file_path or "").suffix.lower() if doc.file_path else ""
        doc_type = "excel" if ext in (".xlsx", ".xls") else ext.lstrip(".") or "unknown"
        per_doc_stats[doc_id] = {
            "doc_id": doc_id,
            "doc_name": doc.original_filename,
            "doc_type": doc_type,
            "page_count": doc.page_count,
            "items_raw": len(extracted),
            "items_sourced": sum(1 for i in extracted if i.get("source_paragraph") and i["source_paragraph"] != "Source non identifiée"),
        }

    # B2: Detect product support type (euros / uc / mixte)
    product_support = _detect_product_support(doc_texts_for_support)
    logger.info(f"[referentiel] Produit {product_id}: support détecté = '{product_support}'")

    # Deduplicate across documents
    final_items_data = _deduplicate(raw_items)

    # B3: Filter noise items (Aucune règle mentionnée, etc.)
    before_noise = len(final_items_data)
    final_items_data = [i for i in final_items_data if not _is_noise_value(i.get("rule_value") or "")]
    logger.info(f"[referentiel] Filtre bruit: {before_noise} → {len(final_items_data)} items ({before_noise - len(final_items_data)} supprimés)")

    # B3: Filter hors-scope categories based on support type
    before_scope = len(final_items_data)
    final_items_data = _filter_hors_scope(final_items_data, product_support)
    logger.info(f"[referentiel] Filtre hors-scope ({product_support}): {before_scope} → {len(final_items_data)} items ({before_scope - len(final_items_data)} supprimés)")

    # Compute per-doc category coverage for stats
    ALL_DOMAINS = [f"8.{i}" for i in range(1, 25)] + ["8.99"]
    for doc_id, stats in per_doc_stats.items():
        doc_items = [i for i in final_items_data if doc_id in _get_doc_ids(i)]
        covered_cats = set()
        for it in doc_items:
            cat = (it.get("category") or "")
            m = re.match(r"(8\.\d+)", cat)
            if m:
                covered_cats.add(m.group(1))
        empty_domains = [d for d in ALL_DOMAINS if d not in covered_cats]
        stats["items_final"] = len(doc_items)
        stats["categories_covered"] = sorted(covered_cats)
        stats["categories_empty"] = empty_domains[:10]  # top 10 empty domains
        pct = round(stats["items_sourced"] / max(stats["items_raw"], 1) * 100, 1)
        stats["pct_sourced"] = pct

    # Insert final items with version number
    all_items: list[ReferentielItem] = []
    for item_data in final_items_data:
        item = ReferentielItem(
            product_id=product_id,
            version_number=next_version,
            source_document_id=item_data.get("source_document_id"),
            source_document_ids=item_data.get("source_document_ids"),
            conflict=item_data.get("conflict", False),
            category=item_data.get("category", ""),
            subcategory=item_data.get("subcategory", ""),
            rule_name=item_data.get("rule_name", ""),
            rule_value=item_data.get("rule_value"),
            rule_unit=item_data.get("rule_unit"),
            source_page=item_data.get("source_page"),
            source_paragraph=item_data.get("source_paragraph", ""),
            ai_confidence=item_data.get("ai_confidence"),
            ai_comment=item_data.get("ai_comment"),
        )
        db.add(item)
        all_items.append(item)

    if not all_items:
        logger.error(f"Produit {product_id}: 0 règles extraites — vérifiez les logs IA et la clé OpenAI")
        raise ValueError("Aucune règle extraite. Vérifiez les logs du backend et la configuration OpenAI.")

    product.status_referentiel = ProductStatus.GENERATED
    db.commit()

    # B4: Quality report after commit (items now have IDs)
    _quality_report([{
        "rule_name": i.rule_name, "rule_value": i.rule_value,
        "source_paragraph": i.source_paragraph, "ai_confidence": i.ai_confidence,
        "conflict": i.conflict, "category": i.category,
    } for i in all_items], product_id, next_version)

    version_obj = _create_version(db, product_id, "Referentiel", all_items, next_version, document_ids=document_ids, doc_stats=per_doc_stats)
    _save_referentiel_file(db, product, document_ids, version_obj)

    # Save DocReadingReport for each document
    try:
        for doc_id, r_stats in reading_stats.items():
            rr = DocReadingReport(
                product_id=product_id,
                referentiel_version_number=next_version,
                document_id=doc_id,
                document_name=r_stats.get("document_name"),
                document_type=r_stats.get("document_type"),
                file_size_bytes=r_stats.get("file_size_bytes"),
                page_count=r_stats.get("page_count"),
                section_count=r_stats.get("section_count"),
                table_count=r_stats.get("table_count"),
                paragraph_count=r_stats.get("paragraph_count"),
                char_count=r_stats.get("char_count"),
                chunk_count=r_stats.get("chunk_count"),
                token_estimate=r_stats.get("token_estimate"),
                pct_read=r_stats.get("pct_read"),
                items_extracted=r_stats.get("items_extracted", 0),
                status=r_stats.get("status", "READ_COMPLETE"),
            )
            db.add(rr)
        db.commit()
        logger.info(f"[referentiel] {len(reading_stats)} rapports de lecture sauvegardés (V{next_version})")
    except Exception as e:
        logger.warning(f"[referentiel] Erreur sauvegarde rapports de lecture: {e}")
        db.rollback()

    return all_items


def get_referentiel(db: Session, product_id: int) -> list[ReferentielItem]:
    return db.query(ReferentielItem).filter(ReferentielItem.product_id == product_id).all()


def export_referentiel_excel(db: Session, product_id: int) -> str:
    product = db.query(Product).filter(Product.id == product_id).first()
    items = get_referentiel(db, product_id)
    items_dict = [
        {
            "category": i.category,
            "subcategory": i.subcategory,
            "rule_name": i.rule_name,
            "rule_value": i.rule_value,
            "rule_unit": i.rule_unit,
            "source_document": i.source_document.original_filename if i.source_document else "",
            "source_page": i.source_page,
            "source_paragraph": i.source_paragraph,
            "ai_confidence": i.ai_confidence,
            "ai_comment": i.ai_comment,
        }
        for i in items
    ]
    return export_referentiel(product.boss_number, items_dict)


def _save_referentiel_file(db: Session, product: Product, document_ids: list[int], version_obj: Version) -> None:
    """Generate a Markdown referentiel file and save it to the product's Output/ folder."""
    try:
        docs = db.query(Document).filter(
            Document.id.in_(document_ids),
            Document.product_id == product.id,
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
            return

        content = ai_service.generate_referentiel_document(
            boss_number=product.boss_number,
            product_name=product.name,
            doc_texts=doc_texts,
        )

        output_dir = Path(settings.documents_dir) / "produits" / product.boss_number / "Output"
        output_dir.mkdir(parents=True, exist_ok=True)

        # File name includes the version number for clear traceability
        file_name = f"referentiel_produit_{product.boss_number}_V{version_obj.version_number}.md"
        file_path = output_dir / file_name
        file_path.write_text(content, encoding="utf-8")

        # Store file path in Version record
        version_obj.file_path = str(file_path)
        db.commit()
    except Exception as e:
        logger.error(f"Erreur génération fichier référentiel : {e}")


def _create_version(
    db: Session,
    product_id: int,
    artifact_type: str,
    items: list,
    version_number: int,
    document_ids: list[int] | None = None,
    doc_stats: dict | None = None,
) -> Version:
    snapshot = [
        {"id": i.id, "category": i.category, "rule_name": i.rule_name, "rule_value": i.rule_value}
        for i in items
    ]
    version = Version(
        product_id=product_id,
        artifact_type=artifact_type,
        version_number=version_number,
        version_label=f"V{version_number}",
        snapshot=snapshot,
        document_ids=json.dumps(document_ids) if document_ids is not None else None,
        doc_stats=json.dumps(doc_stats, ensure_ascii=False) if doc_stats is not None else None,
    )
    db.add(version)
    db.commit()
    return version


def update_referentiel_from_version(
    db: Session,
    product_id: int,
    base_version: int,
    new_document_ids: list[int],
) -> list[ReferentielItem]:
    """
    Create a new referentiel version by inheriting base_version documents and adding new_document_ids.
    The new documents take priority in case of conflict with the base version.
    """
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise ValueError(f"Produit {product_id} introuvable.")

    # Load base version document IDs
    base_ver_obj = db.query(Version).filter(
        Version.product_id == product_id,
        Version.artifact_type == "Referentiel",
        Version.version_number == base_version,
    ).first()
    if not base_ver_obj:
        raise ValueError(f"Version V{base_version} introuvable pour le produit {product_id}.")

    base_doc_ids: list[int] = []
    if base_ver_obj.document_ids:
        try:
            base_doc_ids = json.loads(base_ver_obj.document_ids)
        except Exception:
            pass

    # Merge: base docs first, then new docs (new docs will override on conflict)
    all_doc_ids = list(dict.fromkeys(base_doc_ids + new_document_ids))  # preserve order, deduplicate
    return generate_referentiel(db, product_id, all_doc_ids)
