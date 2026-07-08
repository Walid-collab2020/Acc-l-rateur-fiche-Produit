import json
import logging
from datetime import datetime
from typing import Optional
import anthropic
from openai import OpenAI
from app.config import settings

# Provider actif pour la requête en cours (single-user app)
_ACTIVE_PROVIDER: str = "openai"

def set_active_provider(provider: str) -> None:
    global _ACTIVE_PROVIDER
    _ACTIVE_PROVIDER = provider

def get_active_provider() -> str:
    return _ACTIVE_PROVIDER

def _is_fast(model: str) -> bool:
    return any(x in model.lower() for x in ("mini", "haiku", "fast"))
from app.services.kelia_constants import (
    NO_VALUE as _NO_VALUE_CONST,
    _EXTRACTION_RULES as _EXTRACTION_RULES_CONST,
    _OUTPUT_FORMAT as _OUTPUT_FORMAT_CONST,
    _SYNONYMES_MAPPING as _SYNONYMES_MAPPING_CONST,
    _SCORE_RULES as _SCORE_RULES_CONST,
)
from app.services import bmad_agents

logger = logging.getLogger(__name__)

DOCUMENT_CATEGORIES = [
    "Conditions Générales",
    "Note Technique Actuarielle",
    "Notice",
    "Avenant",
    "Extraction BOSS",
    "Fiche Paramétrage BOSS",
    "Fiche Produit",
    "Paramétrage KELIA",
    "Compte-rendu Atelier",
    "Décision de conception",
    "Arbitrage",
    "Documentation complémentaire",
    "Documentation Générique",
    "Autres",
]


def get_client():
    if _ACTIVE_PROVIDER == "anthropic":
        return anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return OpenAI(api_key=settings.openai_api_key)


def _call(model: str, prompt: str, max_tokens: int = 500) -> str:
    """Appel LLM — dispatche vers le provider actif."""
    fast = _is_fast(model)
    if _ACTIVE_PROVIDER == "anthropic":
        actual = settings.anthropic_model_fast if fast else settings.anthropic_model
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key or None)
        resp = client.messages.create(
            model=actual, max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text.strip()
    elif _ACTIVE_PROVIDER == "openai-gpt5":
        client = OpenAI(api_key=settings.openai_api_key or None)
        resp = client.chat.completions.create(
            model=settings.openai_model_gpt5,
            messages=[{"role": "user", "content": prompt}],
            max_completion_tokens=max_tokens,
        )
        return resp.choices[0].message.content.strip()
    else:
        actual = settings.openai_model_fast if fast else settings.openai_model
        client = OpenAI(api_key=settings.openai_api_key or None)
        resp = client.chat.completions.create(
            model=actual,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=0,
        )
        return resp.choices[0].message.content.strip()


def _sanitize_json(raw: str) -> str:
    """Remove illegal control characters from a JSON string (keep tab/newline/CR)."""
    import re
    # Remove ASCII control chars except \t (9), \n (10), \r (13)
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', raw)


def _parse_json(raw: str) -> dict | list:
    """Strip markdown code fences and parse JSON, with control-char sanitization and truncation recovery."""
    # Strip code fences anywhere in the response
    if "```" in raw:
        parts = raw.split("```")
        for part in parts:
            stripped = part.lstrip("json").strip()
            if stripped.startswith("{") or stripped.startswith("["):
                raw = stripped
                break
    raw = raw.strip()

    # Try direct parse first
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Sanitize control characters and retry
    sanitized = _sanitize_json(raw)
    try:
        return json.loads(sanitized)
    except json.JSONDecodeError:
        pass

    # Recovery: truncated JSON → find last valid item and close the structure
    for candidate in (sanitized, raw):
        for array_key in ('"items"', '"mappings"'):
            if array_key in candidate:
                last_close = candidate.rfind("},")
                if last_close == -1:
                    last_close = candidate.rfind("}")
                if last_close > 0:
                    truncated = candidate[:last_close + 1]
                    try:
                        return json.loads(truncated + "]}")
                    except json.JSONDecodeError:
                        pass

    return json.loads(sanitized)  # re-raise on sanitized version


def classify_document(text: str, filename: str) -> dict:
    """
    Classify a document using both its filename and content.
    Returns: {category, confidence, summary, reason, detected_product_number}
    """
    if not text or len(text.strip()) < 50:
        return {
            "category": "Autres",
            "confidence": 0.1,
            "summary": "Document vide ou illisible",
            "reason": "Texte insuffisant pour classification",
            "detected_product_number": None,
        }

    categories_str = "\n".join(f"- {c}" for c in DOCUMENT_CATEGORIES)
    text_sample = text[:4000]

    prompt = f"""Tu es un expert en migration de produits d'assurance-vie vers le système KELIA.

Classifie ce document dans l'une des catégories suivantes :
{categories_str}

Indices importants :
- Le nom du fichier est souvent révélateur : "CG" = Conditions Générales, "NT" = Note Technique Actuarielle, "parametrage_BOSS" ou "fiche_parametrage_BOSS" = Fiche Paramétrage BOSS, "parametrage_KELIA" = Paramétrage KELIA, "fiche" seul = Fiche Produit, "avenant" = Avenant, "notice" = Notice
- Utilise à la fois le nom du fichier ET le contenu pour ta décision

Nom du fichier : {filename}

Début du contenu :
---
{text_sample}
---

Extrait aussi le numéro de produit BOSS s'il est mentionné (ex : 503, 506, 650...).

Réponds UNIQUEMENT en JSON :
{{
  "category": "<catégorie exacte parmi la liste>",
  "confidence": <float entre 0 et 1>,
  "summary": "<résumé en 2-3 phrases>",
  "reason": "<justification de la classification>",
  "detected_product_number": "<numéro BOSS ou null>"
}}"""

    try:
        raw = _call(settings.anthropic_model_fast, prompt, max_tokens=500)
        result = _parse_json(raw)
        if result.get("category") not in DOCUMENT_CATEGORIES:
            result["category"] = "Autres"
        return result
    except Exception as e:
        logger.error(f"Erreur classification document : {e}")
        return {
            "category": "Autres",
            "confidence": 0.0,
            "summary": "Erreur lors de la classification",
            "reason": str(e),
            "detected_product_number": None,
        }


# Constants are defined in kelia_constants.py and re-exported here for backward compatibility
NO_VALUE = _NO_VALUE_CONST
_EXTRACTION_RULES = _EXTRACTION_RULES_CONST
_OUTPUT_FORMAT = _OUTPUT_FORMAT_CONST


def _extraction_prompt_admin(text_sample: str, product_number: str, document_name: str) -> str:
    return f"""Tu es un actuaire expert en migration de portefeuille d'assurance-vie vers KELIA.
Analyse ce document du produit BOSS {product_number} ({document_name}).

{_EXTRACTION_RULES}

CHAMPS À RECHERCHER (organisés par catégorie) :

identification_produit :
Nom commercial du produit | Assureur / compagnie d'assurance | Adresse assureur | Siège social (mention pied de page) | Nature juridique | N° des Conditions Générales | Type de contrat | Objet du contrat | Régime fiscal | Branche d'assurance | Droit applicable | Libellé du contrat | Actif de couverture | Sortie principale | Affiliation | Statut de commercialisation | SI d'origine | SI cible | Gestionnaire | Contrôle prudentiel | Médiation | Service réclamations | Informatique et Libertés / RGPD

durée_résiliation :
Durée initiale contrat collectif | Conditions de renouvellement | Conditions de résiliation | Droits acquis en cas de résiliation

dates_de_valeur :
DV versements reçus avant le 15 du mois | DV versements reçus entre le 15 et fin de mois | DV frais sur encours | DV transfert individuel | DV rachat | Date d'effet rente (règle générale) | Date d'effet rente (âge plancher) | Date d'effet rente (report possible) | Date de calcul du capital constitutif

obligations_information :
Attribution annuelle PB | Revalorisation rente en service | Information annuelle assurés | Prescription — actions sur le contrat | Prescription — assurance vie bénéficiaire distinct | Prescription — décès assuré (bénéficiaire)

défaut_paiement :
Défaut paiement — relance | Défaut paiement — suspension | Défaut paiement — résiliation

cotisations :
Cotisations obligatoires (description) | Fractionnement paiement | Assiette de cotisation | Tranches possibles | Assiette forfaitaire possible | Taux minimum cotisation | Cotisations de rattrapage | Versements CET

versements_facultatifs :
Versements volontaires libres | Versements libres CET via employeur | Transferts entrants socle obligatoire | Transferts entrants socle facultatif | Règlement des VIF libres | Versements sans bulletin | Lutte anti-blanchiment VIF

arbitrages :
Règles d'arbitrage (conditions, délais, frais)

frais :
Frais sur versements — cotisations obligatoires | Frais sur versements — volontaires libres | Frais sur versements — CET | Frais sur versements — socle facultatif | Base de calcul frais sur versements | Frais de gestion sur encours (taux) | Moment prélèvement frais encours | Frais sur arrérages rentes en service | Frais de gestion rentes — constitution | Frais de transfert individuel | Taxe sur cotisations | Taxe sur versements volontaires

Document :
---
{text_sample}
---

Réponds UNIQUEMENT en JSON :
{_OUTPUT_FORMAT}"""


def _extraction_prompt_technique(text_sample: str, product_number: str, document_name: str) -> str:
    return f"""Tu es un actuaire expert en migration de portefeuille d'assurance-vie vers KELIA.
Analyse ce document du produit BOSS {product_number} ({document_name}).

{_EXTRACTION_RULES}

CHAMPS TECHNIQUES ET ACTUARIELS À RECHERCHER :

mécanisme_strates :
Définition d'une strate | Affectation des versements aux strates | Rachat partiel — ordre de sortie des strates | Intérêts techniques (taux, mode) | PB / frais sur encours (mode de calcul) | Nature de la PM en période de constitution | Conversion en rente (modalités)

tables_mortalité :
Table de mortalité applicable avant le 01/01/2007 | Table de mortalité applicable à partir du 01/01/2007 | Référence réglementaire tables de mortalité

taux_technique :
Taux technique au 01/08/2016 | Historique des taux techniques | Référence réglementaire taux technique

calcul_rente :
Formule générale de calcul de la rente | Variables du calcul | Interpolation des coefficients de mortalité (cas général) | Interpolation des coefficients (multi-têtes)

PB_participation_benefices :
Taux de participation aux bénéfices financiers | Déduction des frais avant PB | Attribution PB (règle) | PB en cours d'année (liquidation / décès / rachat / transfert)

rachats :
Rachat autorisé — cas 1 | Rachat autorisé — cas 2 | Rachat autorisé — cas 3 | Rachat autorisé — cas 4 | Rachat autorisé — cas 5 | Rachat autorisé — cas 6 | Valeur de rachat (formule) | Délai de paiement rachat | Montant versé au rachat | Disponibilité libre de l'épargne

transfert_individuel :
Conditions de transfert individuel | Contrats destinataires du transfert | Valeur de transfert | Frais de transfert | Délai notification valeur de transfert | Délai de renonciation au transfert | Délai de virement après renonciation | Pièces requises pour le transfert | Effet du transfert | VIF libres après départ entreprise

garanties_décès :
Prestation décès en phase de constitution | Revalorisation capital décès post-décès | Revalorisation minimum capital décès | Clause bénéficiaire standard (ordre) | Désignation nominative | Acceptation bénéficiaire | Délai avant acceptation (désignation à titre gratuit) | Effet de l'acceptation bénéficiaire

liquidation_rente :
Condition de liquidation | Date d'effet de la rente à liquidation | Pièces requises pour la liquidation | Montant de la rente | Modalités de paiement rente | Prorata au décès du rentier | Certificat de vie | Faible rente — seuil | Faible rente — montant versement unique

options_rente :
Option réversion — description | Bénéficiaires de réversion | Réversion simple tête — prise en charge SIP | Réversion multi-têtes — prise en charge SIP | Date d'effet rente de réversion | Obligation signalement mariages/divorces post-liquidation | Option annuités garanties — description | Durée garantie (assuré < 70 ans) | Durée garantie (assuré 70 à < 75 ans) | Option rente modulable | Option dépendance — garantie CG 8010A | Option dépendance — garantie CG 0803/2 | Tarif dépendance homme | Tarif dépendance femme | Exclusivité des options rente

fonds_collectifs :
Fonds de service — PM début d'exercice | Fonds de service — capitaux constitutifs rentes liquidées | Fonds de service — produits financiers | Fonds de service — arrérages | Fonds de service — frais de gestion rentes | Fonds de service — solde créditeur / débiteur | Fonds collectif revalorisation — crédit report exercice précédent | Fonds collectif revalorisation — produits financiers | Fonds collectif revalorisation — capitaux constitutifs revalorisation | Autorité de décision revalorisation rente | Critères de décision revalorisation | Date de revalorisation rente en service | Assiette de revalorisation

points_attention_SIP :
Gestion multi-strates dans SIP | Deux tables de mortalité distinctes | Historique des taux techniques à mapper | Options rente non gérées SIP (calcul manuel) | PB en cours d'année (taux provisoire SIP) | Séparation socle obligatoire / facultatif dans SIP | Faible rente — seuil rachat automatique SIP | Réversion multi-bénéficiaires art. L.912-4 | Dates de valeur des versements à configurer | Délais réglementaires à surveiller | Revalorisation capital décès post-01/01/2016 | Fractionnement paiement rente | Codes SIP à mapper | Fonds collectifs (service + revalorisation)

Document :
---
{text_sample}
---

Réponds UNIQUEMENT en JSON :
{_OUTPUT_FORMAT}"""


def extract_referentiel(text: str, product_number: str, document_name: str) -> list[dict]:
    """
    Exhaustive extraction using BMAD multi-agent pipeline (3 passes: Actuaire, Juriste, Consolidateur).
    Falls back to legacy 2-pass logic if BMAD pipeline fails.
    """
    try:
        return bmad_agents.bmad_extract_referentiel(text, product_number, document_name)
    except Exception as e:
        logger.error(
            f"[extract_referentiel][{document_name}] BMAD pipeline failed, falling back to legacy: {type(e).__name__}: {e}"
        )

    # --- Legacy fallback ---
    text_sample = text[:12000]
    all_items: list[dict] = []

    for prompt_fn in (_extraction_prompt_admin, _extraction_prompt_technique):
        prompt = prompt_fn(text_sample, product_number, document_name)
        try:
            raw = _call(settings.anthropic_model, prompt, max_tokens=4096)
            result = _parse_json(raw)
            items = result.get("items", [])
            count_before = len(all_items)
            for item in items:
                if item.get("rule_value") is not None:
                    all_items.append(item)
            logger.info(
                f"[{document_name}] {prompt_fn.__name__}: {len(all_items) - count_before} items extraits"
            )
        except Exception as ex:
            logger.error(
                f"[{document_name}] Erreur extraction {prompt_fn.__name__}: {type(ex).__name__}: {ex}"
            )

    logger.info(f"[{document_name}] Total: {len(all_items)} règles extraites (legacy fallback)")
    return all_items


def generate_fiche_produit(referentiel_items: list[dict], product_number: str, kelia_guide_text: str = "") -> list[dict]:
    """Generate fiche produit KELIA from referentiel items."""
    ref_summary = json.dumps(referentiel_items[:50], ensure_ascii=False, indent=2)
    guide_sample = kelia_guide_text[:3000] if kelia_guide_text else "Non fourni"

    prompt = f"""Tu es un expert en paramétrage KELIA (système de gestion d'assurance-vie).

Sur la base du référentiel produit BOSS {product_number} suivant :
{ref_summary}

Et du guide de paramétrage KELIA (extrait) :
{guide_sample}

Génère la fiche produit cible KELIA avec les sections suivantes :
- Identification produit
- Versements et cotisations
- Garanties
- Options et arbitrages
- Rachats et avances
- Revalorisation et PB/PPB
- TMG
- Fiscalité
- Actes de gestion

Réponds UNIQUEMENT en JSON :
{{
  "items": [
    {{
      "section": "<section KELIA>",
      "subsection": "<sous-section>",
      "rule_name": "<nom paramètre KELIA>",
      "rule_value": "<valeur cible>",
      "justification": "<justification>",
      "source_reference": "<référence documentaire>",
      "confidence": <float 0-1>,
      "comment": "<commentaire>"
    }}
  ]
}}"""

    try:
        raw = _call(settings.anthropic_model, prompt, max_tokens=4000)
        result = _parse_json(raw)
        return result.get("items", [])
    except Exception as e:
        logger.error(f"Erreur génération fiche produit : {e}")
        return []


def detect_atelier_changes(atelier_text: str, current_referentiel: list[dict]) -> dict:
    """Detect changes in an atelier CR and their impacts."""
    ref_summary = json.dumps(current_referentiel[:30], ensure_ascii=False, indent=2)
    text_sample = atelier_text[:5000]

    prompt = f"""Tu es un expert en migration de produits d'assurance-vie.

Analyse ce compte-rendu d'atelier et identifie :
1. Les nouvelles décisions ou modifications par rapport au référentiel existant
2. Les impacts sur le paramétrage KELIA

Référentiel actuel (extrait) :
{ref_summary}

Compte-rendu d'atelier :
---
{text_sample}
---

Réponds UNIQUEMENT en JSON :
{{
  "summary": "<résumé des décisions>",
  "detected_changes": [
    {{
      "rule_name": "<règle concernée>",
      "old_value": "<ancienne valeur ou null>",
      "new_value": "<nouvelle valeur>",
      "reason": "<raison de la modification>"
    }}
  ],
  "impacts": {{
    "referentiel": ["<impact 1>"],
    "fiche": ["<impact 1>"],
    "parametrage": ["<impact 1>"]
  }}
}}"""

    try:
        raw = _call(settings.anthropic_model, prompt, max_tokens=2000)
        return _parse_json(raw)
    except Exception as e:
        logger.error(f"Erreur détection changements atelier : {e}")
        return {"summary": str(e), "detected_changes": [], "impacts": {}}


def compare_parametrage(target_items: list[dict], delivered_items: list[dict]) -> list[dict]:
    """
    Compare delivered KELIA parametrage against target fiche produit.
    Uses BMAD 3-agent pipeline (ExpertFonctionnel, ExpertTechnique, AuditeurEcarts).
    Falls back to legacy single-call logic if BMAD pipeline fails.
    """
    try:
        return bmad_agents.bmad_compare_parametrage(target_items, delivered_items)
    except Exception as e:
        logger.error(f"[compare_parametrage] BMAD pipeline failed, falling back to legacy: {type(e).__name__}: {e}")

    # --- Legacy fallback ---
    target_json = json.dumps(target_items[:40], ensure_ascii=False, indent=2)
    delivered_json = json.dumps(delivered_items[:40], ensure_ascii=False, indent=2)

    prompt = f"""Tu es un expert QA en paramétrage KELIA.

Compare le paramétrage livré par KAPIA avec la fiche produit cible validée.

Paramétrage cible attendu :
{target_json}

Paramétrage livré :
{delivered_json}

Pour chaque règle, détermine le statut :
- Conforme, Écart, Manquant, Supplémentaire, Non contrôlable

Réponds UNIQUEMENT en JSON :
{{
  "details": [
    {{
      "module": "<module>",
      "rule_name": "<règle>",
      "expected_value": "<valeur attendue>",
      "obtained_value": "<valeur obtenue>",
      "status": "<Conforme|Écart|Manquant|Supplémentaire|Non contrôlable>",
      "criticite": "<Critique|Majeure|Mineure>",
      "justification": "<explication>",
      "ai_comment": "<commentaire>"
    }}
  ]
}}"""

    try:
        raw = _call(settings.anthropic_model, prompt, max_tokens=4000)
        result = _parse_json(raw)
        return result.get("details", [])
    except Exception as ex:
        logger.error(f"Erreur comparaison paramétrage (legacy fallback) : {ex}")
        return []


def extract_cr_atelier(text: str, product_number: str) -> list[dict]:
    """
    Extract all decisions, corrections, and parameter values from a CR Atelier document.
    Returns [{rule_name, value, source_paragraph}].
    """
    text_sample = text[:8000]
    prompt = f"""Tu es un actuaire expert en produits d'assurance-vie.
Voici un CR d'atelier de validation de fiche produit pour le produit BOSS {product_number}.

DOCUMENT :
---
{text_sample}
---

Extrais TOUTES les décisions, validations, corrections et valeurs de paramètres mentionnées dans ce CR.
Chaque item doit avoir :
- rule_name : nom court du paramètre/règle (ex : "Taux de frais de gestion", "Age minimum")
- value : valeur décidée ou validée (ex : "13%", "18 ans", "OUI")
- source_paragraph : extrait exact du CR justifiant cette valeur

Réponds UNIQUEMENT en JSON valide :
{{
  "items": [
    {{
      "rule_name": "<nom du paramètre>",
      "value": "<valeur décidée>",
      "source_paragraph": "<extrait exact du CR>"
    }}
  ]
}}"""
    try:
        raw = _call(settings.anthropic_model_fast, prompt, max_tokens=2048)
        result = _parse_json(raw)
        items = result.get("items", [])
        logger.info(f"[extract_cr_atelier] {len(items)} décisions extraites du CR")
        return items
    except Exception as e:
        logger.error(f"[extract_cr_atelier] Erreur: {type(e).__name__}: {e}")
        return []


# Re-exported from kelia_constants for backward compatibility
_SYNONYMES_MAPPING = _SYNONYMES_MAPPING_CONST
_SCORE_RULES = _SCORE_RULES_CONST


def pre_mapping_pass(
    all_fields: list[dict],
    referentiel_items: list[dict],
) -> list[dict]:
    """
    Build the full mapping table: KELIA template field → best referentiel item match.
    Uses BMAD 2-agent pipeline (ExpertKELIA + ValidateurMapping).
    Falls back to legacy single-call logic if BMAD pipeline fails.

    match_type:
      "exact"      → libellé identique ou quasi-identique (score 95-100)
      "synonyme"   → synonyme métier connu (score 80-90)
      "hypothese"  → correspondance sémantique approchée (score 40-70)
      "non_trouve" → aucun candidat (score 0)

    Returns list of dicts: {champ_kelia, champ_ref, valeur_ref, match_type, score, justification}
    """
    try:
        return bmad_agents.bmad_pre_mapping(all_fields, referentiel_items)
    except Exception as e:
        logger.error(f"[pre_mapping_pass] BMAD pipeline failed, falling back to legacy: {type(e).__name__}: {e}")

    # --- Legacy fallback ---
    NO_VALUE_MARKERS = {
        "aucune règle mentionnée", "non renseigné", "non mentionné",
        "non trouvé", "sans objet", "n/a",
    }
    real_ref = [
        item for item in referentiel_items
        if item.get("rule_value") and not any(
            m in (item.get("rule_value") or "").lower() for m in NO_VALUE_MARKERS
        )
    ]

    ref_lines = []
    for item in real_ref:
        ref_lines.append(f'- "{item.get("rule_name","")}" : "{str(item.get("rule_value",""))[:120]}"')
    ref_text = "\n".join(ref_lines) if ref_lines else "(aucun item)"

    fields_lines = []
    for f in all_fields:
        param = f.get("parameter", "")
        vp = f.get("valeurs_possibles") or ""
        line = f'- "{param}"'
        if vp:
            line += f'  [valeurs_possibles: {vp[:80]}]'
        fields_lines.append(line)
    fields_text = "\n".join(fields_lines)

    prompt = f"""Tu es un expert en paramétrage KELIA (assurance vie / retraite collective).

Tu dois construire la table de correspondance entre les champs du template KELIA et les règles du référentiel produit.

## RÉFÉRENTIEL PRODUIT ({len(real_ref)} règles) :
{ref_text}

{_SYNONYMES_MAPPING}

## CHAMPS KELIA À MAPPER ({len(all_fields)} champs) :
{fields_text}

## RÈGLES DE MATCHING :
- "exact" (score 95-100) : le libellé du champ KELIA correspond exactement ou presque à la règle référentiel
- "synonyme" (score 80-94) : synonyme métier direct selon la liste ci-dessus
- "hypothese" (score 40-79) : correspondance sémantique approchée — le sens est proche mais le libellé diffère significativement
  → Dans ce cas, la justification DOIT expliquer l'hypothèse faite (ex: "Frais de gestion assimilé à Frais sur versement acquisition")
- "non_trouve" (score 0) : aucun item référentiel ne correspond

## FORMAT DE SORTIE
Réponds UNIQUEMENT en JSON valide :
{{
  "mappings": [
    {{
      "champ_kelia": "<nom exact du champ KELIA>",
      "champ_ref": "<rule_name exact du référentiel, ou null>",
      "valeur_ref": "<rule_value du référentiel, ou null>",
      "match_type": "exact | synonyme | hypothese | non_trouve",
      "score": <int 0-100>,
      "justification": "<explication de l'hypothèse, ou null si exact/synonyme>"
    }}
  ]
}}

IMPORTANT : inclure UN mapping par champ KELIA de la liste."""

    try:
        raw = _call(settings.anthropic_model, prompt, max_tokens=4096)
        result = _parse_json(raw)
        mappings = result.get("mappings", [])
        logger.info(f"[pre_mapping_pass] {len(mappings)} mappings construits ({len(real_ref)} règles ref) (legacy fallback)")
        return mappings
    except Exception as ex:
        logger.error(f"[pre_mapping_pass] Erreur (legacy fallback): {type(ex).__name__}: {ex}")
        return []


def fill_fiche_sheet(
    sheet_name: str,
    fields: list[dict],
    referentiel_items: list[dict],
    product_number: str,
    cr_items: list[dict] | None = None,
    mapping_table: list[dict] | None = None,
) -> list[dict]:
    """
    Fill one sheet of the Fiche Produit KELIA template using referentiel items.
    Uses BMAD 2-agent pipeline (MOAAssurance + ControleurCoherence).
    Falls back to legacy single-call logic if BMAD pipeline fails.
    CR atelier items take priority over the referentiel when present.
    """
    try:
        return bmad_agents.bmad_fill_fiche_sheet(
            sheet_name, fields, referentiel_items, product_number, cr_items, mapping_table
        )
    except Exception as e:
        logger.error(
            f"[fill_fiche_sheet] BMAD pipeline failed for sheet '{sheet_name}', falling back to legacy: {type(e).__name__}: {e}"
        )

    # --- Legacy fallback ---
    NO_VALUE_MARKERS = {
        "aucune règle mentionnée", "non renseigné", "non mentionné",
        "non trouvé", "sans objet", "n/a",
    }
    real_ref = [
        item for item in referentiel_items
        if item.get("rule_value") and not any(
            m in (item.get("rule_value") or "").lower() for m in NO_VALUE_MARKERS
        )
    ]

    mapping_lookup: dict[str, dict] = {}
    if mapping_table:
        for m in mapping_table:
            key = (m.get("champ_kelia") or "").strip().lower()
            if key:
                mapping_lookup[key] = m

    ref_lines = []
    for item in real_ref:
        rule_name = item.get("rule_name", "")
        rule_value = item.get("rule_value", "")
        source_doc = item.get("source_doc", "")
        conflict_flag = " [CONFLIT]" if item.get("conflict") else ""
        ref_lines.append(
            f'- champ="{rule_name}" | valeur="{rule_value}" | source="{source_doc}"{conflict_flag}'
        )
    ref_summary = "\n".join(ref_lines) if ref_lines else "(aucun item référentiel avec valeur)"

    mapping_hints = ""
    if mapping_lookup:
        sheet_fields_keys = {f.get("parameter","").strip().lower() for f in fields}
        relevant = [m for m in mapping_table if (m.get("champ_kelia","").strip().lower() in sheet_fields_keys)]
        if relevant:
            hint_lines = []
            for m in relevant:
                mt = m.get("match_type","")
                if mt == "non_trouve":
                    continue
                justif = f' — HYPOTHÈSE: {m["justification"]}' if mt == "hypothese" and m.get("justification") else ""
                hint_lines.append(
                    f'- "{m["champ_kelia"]}" → référentiel "{m.get("champ_ref","")}" '
                    f'(valeur: "{str(m.get("valeur_ref",""))[:80]}", score: {m.get("score",0)}, type: {mt}){justif}'
                )
            if hint_lines:
                mapping_hints = "\n## PRÉ-MAPPING (correspondances déjà calculées — utiliser en priorité) :\n" + "\n".join(hint_lines) + "\n"

    has_cr = bool(cr_items)
    cr_summary = ""
    if has_cr:
        cr_lines = []
        for item in (cr_items or []):
            rn = item.get("rule_name", "")
            val = item.get("value", "")
            fname = item.get("filename", "")
            src = item.get("source_paragraph", "")
            cr_lines.append(f'- champ="{rn}" | valeur="{val}" | CR="{fname}" | "{src[:100]}"')
        cr_summary = "\n".join(cr_lines)

    fields_lines = []
    for i, field in enumerate(fields, start=1):
        param = field.get("parameter", "")
        valeurs = field.get("valeurs_possibles") or ""
        comment = field.get("kelia_comment") or ""
        line = f'{i}. "{param}"'
        if valeurs:
            line += f" | valeurs_possibles: {valeurs}"
        if comment:
            line += f" | commentaire_kelia: {comment}"
        fields_lines.append(line)
    fields_text = "\n".join(fields_lines)

    cr_section = f"""
CR ATELIER — PRIORITÉ ABSOLUE sur le référentiel :
{cr_summary}
""" if has_cr else ""

    cr_instructions = """
RÈGLE CR ATELIER :
- Si un item CR correspond : cr_override=true, utiliser SA valeur, cr_rule_matched=nom exact de l'item CR.
- Sinon : cr_override=false, cr_rule_matched=null.
""" if has_cr else ""

    prompt = f"""Tu es un expert MOA assurance vie / retraite et paramétrage produit KELIA.

Produit BOSS : {product_number} — Feuille : {sheet_name}

## RÈGLE ABSOLUE ANTI-HALLUCINATION
Ne jamais inventer une valeur. Renseigner UNIQUEMENT si la valeur est explicitement dans le référentiel.
Ne jamais utiliser : "N/A", "À compléter", "Non spécifié" ou toute valeur fictive.

## RÉFÉRENTIEL PRODUIT ({len(real_ref)} règles avec valeur réelle) :
{ref_summary}
{cr_section}
{mapping_hints}
{_SYNONYMES_MAPPING}

{_SCORE_RULES}

## CHAMPS À REMPLIR ({len(fields)} champs) :
{fields_text}

## MÉTHODE
Pour chaque champ :
1. Si le champ apparaît dans le PRÉ-MAPPING ci-dessus : utiliser directement la valeur indiquée.
   - match_type "exact" ou "synonyme" → score tel qu'indiqué, justification = null
   - match_type "hypothese" → score tel qu'indiqué, justification = répéter l'hypothèse telle quelle
2. Sinon : chercher dans le CR Atelier (priorité), puis dans le référentiel.
3. Appliquer les synonymes métier et correspondances KELIA si le libellé diffère.
4. Si le champ a des "valeurs_possibles" : choisir la valeur la plus proche dans la liste.
   Exemple : "Nature du produit" avec valeurs_possibles="Retraite collective / Assurance vie / Capitalisation"
   → Si référentiel dit "contrat collectif retraite supplémentaire Art.83" → retenir "Retraite collective"
5. Si une valeur candidate existe : la renseigner avec son score de confiance.
6. Si aucune valeur candidate : statut = NON_TROUVE, valeur vide.

## FORMAT DE SORTIE
Réponds UNIQUEMENT en JSON valide :
{{
  "items": [
    {{
      "parameter": "<nom EXACT du champ tel que fourni dans la liste>",
      "statut": "RENSEIGNE | NON_TROUVE",
      "valeur_retenue": "<valeur extraite du référentiel, ou null si NON_TROUVE>",
      "score_confiance": <int 0-100>,
      "champ_source": "<rule_name référentiel exact ou null>",
      "valeur_source": "<valeur référentiel ou null>",
      "source_documentaire": "<nom du fichier source ou null>",
      "justification": "<explication du mapping ou null>",
      "cr_override": <true|false>,
      "cr_rule_matched": "<nom item CR ou null>",
      "value_from_referentiel": "<valeur référentiel si cr_override, sinon null>",
      "conflict": <true|false>
    }}
  ]
}}

IMPORTANT : inclure UN item par champ de la liste, dans le même ordre.{cr_instructions}"""

    try:
        raw = _call(settings.anthropic_model, prompt, max_tokens=4096)
        result = _parse_json(raw)
        items = result.get("items", [])
        normalised = []
        for it in items:
            statut = (it.get("statut") or "NON_TROUVE").upper()
            valeur = it.get("valeur_retenue") if statut == "RENSEIGNE" and it.get("valeur_retenue") else None
            normalised.append({
                "parameter":            it.get("parameter"),
                "value":                valeur or NO_VALUE,
                "rule_name_ref":        it.get("champ_source"),
                "source_citation":      it.get("valeur_source"),
                "source_paragraph":     f"Règle référentiel: {it['champ_source']}" if it.get("champ_source") else None,
                "confidence":           (it.get("score_confiance") or 0) / 100.0,
                "conflict":             bool(it.get("conflict", False)),
                "cr_override":          bool(it.get("cr_override", False)),
                "cr_rule_matched":      it.get("cr_rule_matched"),
                "value_from_referentiel": it.get("value_from_referentiel"),
                "comment":              it.get("justification"),
            })
        return normalised
    except Exception as ex:
        logger.error(f"[fill_fiche_sheet] Erreur feuille '{sheet_name}' (legacy fallback): {type(ex).__name__}: {ex}")
        return []


def generate_product_info(text: str, boss_number: str) -> dict:
    """Infer product commercial name and description from document content."""
    text_sample = text[:3000]

    prompt = f"""Tu es un expert en produits d'assurance-vie.

À partir de ce document du produit BOSS {boss_number}, identifie :
1. Le nom commercial du produit (ex : "Capita Invest Plus", "Vita Épargne", etc.)
2. Une description courte (2-3 phrases) du produit

Document :
---
{text_sample}
---

Réponds UNIQUEMENT en JSON :
{{
  "name": "<nom commercial du produit, ou null si non trouvé>",
  "description": "<description courte du produit>"
}}"""

    try:
        raw = _call(settings.anthropic_model_fast, prompt, max_tokens=200)
        return _parse_json(raw)
    except Exception as e:
        logger.error(f"Erreur génération info produit : {e}")
        return {"name": f"Produit BOSS {boss_number}", "description": None}


def generate_referentiel_document(boss_number: str, product_name: Optional[str], doc_texts: list[dict]) -> str:
    """Generate a structured Markdown referentiel document from all product documents."""
    docs_content = ""
    for dt in doc_texts[:8]:
        docs_content += f"\n\n### {dt['filename']} ({dt['category']})\n{dt['text'][:2000]}"

    product_label = f"BOSS {boss_number}" + (f" — {product_name}" if product_name else "")

    prompt = f"""Tu es un expert en migration de produits d'assurance-vie vers le système KELIA.

Génère un Référentiel Produit structuré et complet pour le produit {product_label} à partir des documents ci-dessous.

Ce référentiel doit :
- Être structuré selon les sections définies
- Synthétiser les informations essentielles du produit
- Mentionner les sources utilisées entre parenthèses ex : (Source : nom_fichier.pdf)
- Fournir une vue claire et exploitable
- Indiquer "À compléter" quand l'information n'est pas disponible

Sections obligatoires :
1. Identification du produit
2. Versements et cotisations
3. Garanties
4. Options et arbitrages
5. Rachats et avances
6. Revalorisation et Participation aux Bénéfices
7. Taux Minimum Garanti (TMG)
8. Fiscalité
9. Actes de gestion
10. Points d'attention et questions ouvertes

Documents disponibles ({len(doc_texts)} document(s)) :
{docs_content}

Génère le référentiel complet en Markdown."""

    body = _call(settings.anthropic_model, prompt, max_tokens=4000)

    now = datetime.now().strftime("%d/%m/%Y à %H:%M")
    sources = ", ".join(dt["filename"] for dt in doc_texts)
    header = f"""# Référentiel Produit — {product_label}

> **Généré automatiquement** le {now}
> Sources ({len(doc_texts)}) : {sources}

---

"""
    return header + body
