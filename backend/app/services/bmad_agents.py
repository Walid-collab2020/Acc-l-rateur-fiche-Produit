"""
bmad_agents.py
BMAD (specialized multi-agent) system for KELIA insurance migration.

Defines 10 agent personas and 4 multi-pass workflows that replace the single-LLM-call
functions in ai_service.py.  All constants (NO_VALUE, _SYNONYMES_MAPPING, _SCORE_RULES)
are imported from kelia_constants to avoid circular imports with ai_service.
"""

import json
import logging
import re
import anthropic
from openai import OpenAI
from app.config import settings
from app.services.kelia_constants import (
    NO_VALUE,
    _SYNONYMES_MAPPING,
    _SCORE_RULES,
    _EXTRACTION_RULES,
    _OUTPUT_FORMAT,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# JSON helpers (copied here to avoid circular import with ai_service)
# ---------------------------------------------------------------------------

def _sanitize_json(raw: str) -> str:
    """Remove illegal control characters from a JSON string (keep tab/newline/CR)."""
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', raw)


def _parse_json(raw: str) -> dict | list:
    """Strip markdown code fences and parse JSON, with control-char sanitization and truncation recovery."""
    if "```" in raw:
        parts = raw.split("```")
        for part in parts:
            stripped = part.lstrip("json").strip()
            if stripped.startswith("{") or stripped.startswith("["):
                raw = stripped
                break
    raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    sanitized = _sanitize_json(raw)
    try:
        return json.loads(sanitized)
    except json.JSONDecodeError:
        pass

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


# ---------------------------------------------------------------------------
# Agent personas
# ---------------------------------------------------------------------------

PERSONAS: dict[str, str] = {
    "actuaire": (
        "Tu es un expert actuaire avec 20 ans d'expérience en assurance vie collective et retraite Art.83. "
        "Tu maîtrises les tables de mortalité (TH/TF 00-02, TPRV 93), le TMG, la PM, la PB, les strates, "
        "les formules de rente. Règle absolue : tu ne dois jamais inventer une valeur. "
        "Si une donnée n'est pas dans le document, tu ne la mentionnes pas."
    ),
    "juriste": (
        "Tu es un juriste spécialisé en droit des assurances avec 15 ans d'expérience sur les contrats collectifs. "
        "Tu maîtrises le Code des assurances, les clauses de résiliation/rachat/transfert, les bénéficiaires, "
        "les obligations d'information, et les régimes fiscaux Art.83/39/82 CGI. "
        "Tu extrais les clauses exactes sans les reformuler."
    ),
    "consolidateur": (
        "Tu es un expert en consolidation de données produit d'assurance vie. "
        "Tu fusionne plusieurs extractions, élimines les doublons, identifies les VRAIS conflits "
        "(valeurs contradictoires ≠ simples reformulations) et gardes toujours la source la plus fiable. "
        "Tu ne perds aucune information pertinente lors de la consolidation."
    ),
    "expert_kelia": (
        "Tu es un expert en paramétrage KELIA avec 10 ans d'expérience. "
        "Tu maîtrises parfaitement la nomenclature des champs KELIA, les valeurs possibles, "
        "la structure de la FPP, et la correspondance terminologie produit ↔ KELIA. "
        "Tu identifies les meilleurs rapprochements entre le référentiel produit et les champs KELIA."
    ),
    "validateur_mapping": (
        "Tu es un auditeur de mapping sceptique par défaut. "
        "Tu distingues : exact (95-100) / synonyme (80-94) / hypothese (40-79) / non_trouve (0). "
        "Tu refuses les faux synonymes. Tu exiges une justification explicite pour toute hypothèse. "
        "Un mapping 'hypothese' ne peut JAMAIS avoir un score supérieur à 79."
    ),
    "moa_assurance": (
        "Tu es un MOA Assurance Vie/Retraite avec 15 ans d'expérience sur les projets KELIA. "
        "Tu comprends le sens métier derrière chaque paramètre. "
        "Tu normalises les valeurs brutes vers les valeurs KELIA attendues, "
        "en tenant compte des valeurs_possibles définies dans le template."
    ),
    "controleur_coherence": (
        "Tu es un auditeur QA spécialisé dans la cohérence des fiches KELIA. "
        "Tu vérifies la cohérence inter-champs : Art.83 implique Retraite collective, "
        "frais > 5% sont suspects, TMG > 3,5% post-2016 est impossible, "
        "branche vie ≠ prévoyance pure. "
        "Tu signales uniquement les incohérences réelles, pas les simples absences de valeur."
    ),
    "expert_fonctionnel": (
        "Tu es un expert fonctionnel assurance vie avec une expérience approfondie des migrations KELIA. "
        "Tu analyses le respect fonctionnel du paramétrage livré versus la cible attendue. "
        "Tu parles en termes métier et identifies les impacts sur les assurés et la gestion."
    ),
    "expert_technique": (
        "Tu es un expert technique KAPIA/SIP avec une maîtrise des codes SIP, modules de calcul "
        "et tables de référence KELIA. "
        "Tu identifies précisément les écarts entre les specs fonctionnelles et le paramétrage livré, "
        "en déterminant si la cause est KAPIA ou SIP."
    ),
    "auditeur_ecarts": (
        "Tu es un auditeur adversarial spécialisé dans la recette de paramétrage KELIA. "
        "Tu cherches ACTIVEMENT les écarts, oublis et erreurs. "
        "Tu priorises tous les écarts en : Critique / Majeure / Mineure. "
        "Tu n'acceptes jamais une conformité sans vérification explicite champ par champ."
    ),
    "cartographe": (
        "Tu combines trois rôles simultanément : "
        "(1) Actuaire produit senior — tu extrais chaque paramètre chiffré, formule, table, taux, "
        "barème et hypothèse actuarielle avec une précision absolue ; "
        "(2) Expert MOA Assurance Vie — tu identifies les règles de gestion, les conditions, "
        "les effets sur le contrat, les obligations, les cas particuliers et les exceptions ; "
        "(3) Analyste métier migration — tu documentes tout ce qui sert à construire une fiche produit, "
        "paramétrer un système de gestion, réaliser une migration, et détecter les écarts entre documents. "
        "Ta mission : construire un référentiel EXHAUSTIF, structuré et sourcé, équivalent opérationnel "
        "d'avoir tous les documents originaux à disposition. "
        "Aucune information ne doit être perdue — AUCUNE, sans exception. "
        "RÈGLES ABSOLUES : "
        "Ne jamais inventer. "
        "Ne jamais compléter avec tes connaissances générales. "
        "Ne jamais arbitrer seul entre deux sources contradictoires — signaler dans 'ecarts'. "
        "Ne jamais fusionner deux informations différentes dans une même ligne. "
        "Ne jamais supprimer une information au motif qu'elle paraît secondaire ou inhabituelle. "
        "Ne jamais résumer une règle si le document donne une formulation précise. "
        "Ne jamais conclure qu'une information n'existe pas sans avoir vérifié l'ensemble du passage. "
        "Si valeur absente dans ce document : rule_value = 'NON TROUVEE DANS CE DOCUMENT'. "
        "Si ambigu : rule_value = 'A VERIFIER'. "
        "Granularité atomique : une ligne = une règle, une valeur, une condition ou une exception. "
        "BIAIS DE CONNAISSANCE : une clause atypique ou propre à ce produit est capturée EN PRIORITÉ "
        "dans '8.99 Clauses spécifiques produit'. Une information inhabituelle = information précieuse."
    ),
}

# ---------------------------------------------------------------------------
# Core helper
# ---------------------------------------------------------------------------

def _is_fast(model: str) -> bool:
    return any(x in model.lower() for x in ("mini", "haiku", "fast"))


def _agent_call(agent_name: str, model: str, user_prompt: str, max_tokens: int = 4096) -> str:
    """Appel LLM agent — dispatche vers le provider actif (openai ou anthropic)."""
    from app.services.ai_service import get_active_provider
    provider = get_active_provider()
    fast = _is_fast(model)
    if provider == "anthropic":
        actual = settings.anthropic_model_fast if fast else settings.anthropic_model
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key or None)
        resp = client.messages.create(
            model=actual, max_tokens=max_tokens,
            system=PERSONAS[agent_name],
            messages=[{"role": "user", "content": user_prompt}],
        )
        return resp.content[0].text.strip()
    else:
        actual = settings.openai_model_fast if fast else settings.openai_model
        client = OpenAI(api_key=settings.openai_api_key or None)
        resp = client.chat.completions.create(
            model=actual,
            messages=[
                {"role": "system", "content": PERSONAS[agent_name]},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=max_tokens,
            temperature=0,
        )
        return resp.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# NO_VALUE filter helper (shared across workflows)
# ---------------------------------------------------------------------------

def _is_noise(val: str) -> bool:
    v = (val or "").strip().lower()
    return not v or any(m in v for m in (
        "aucune règle", "non renseigné", "non mentionné", "non trouvé",
        "sans objet", "n/a", "non documenté", "néant", "non applicable",
    ))


_NO_VALUE_MARKERS = {
    "aucune règle mentionnée", "non renseigné", "non mentionné",
    "non trouvé", "sans objet", "n/a",
    "aucune règle", "non mentionné dans", "non trouvé dans",
    "aucun", "non documenté", "néant",
}


def _filter_real_ref(referentiel_items: list[dict]) -> list[dict]:
    """Return only items that carry a real value (not NO_VALUE sentinels)."""
    return [
        item for item in referentiel_items
        if item.get("rule_value") and not any(
            m in (item.get("rule_value") or "").lower() for m in _NO_VALUE_MARKERS
        )
    ]


# ---------------------------------------------------------------------------
# Cartographe exhaustif — extraction principale
# ---------------------------------------------------------------------------

_CARTOGRAPHE_DOMAINES = """
DOMAINES À CARTOGRAPHIER (extraire TOUTES les informations atomiques) :
8.1 Identification produit : Nom, Référence, CG, Nature juridique, Type contrat, Adhésion, Branche, Assureur, Souscripteur, Population, Statut commercial, SI source/cible, Article fiscal, Support investissement
8.2 Durée et vie du contrat : Date d'effet, Durée, Résiliation, Préavis, Suspension, Non-paiement, Droits acquis, Radiation, Sortie entreprise
8.3 Assurés et souscription : Affiliation, Population obligatoire, Nouveaux salariés, Obligations entreprise, Données assurés
8.4 Cotisations et versements : Cotisations obligatoires/entreprise/salariales, VIF, CET, Assiette (TA/TB/TC/TD), Taux min/max, Périodicité, Mode règlement, LAB
8.5 Dates de valeur : DV cotisation, DV versement, DV CET, DV rachat, DV transfert, DV décès, DV liquidation — toutes les règles avant/après 15 du mois
8.6 Frais : Frais sur cotisations, versements obligatoires/volontaires, encours, arrérages, gestion rentes, transfert, rachat, arbitrage, plafonds, base de calcul, moment prélèvement
8.7 Constitution des droits : Compte individuel, tarif réglementaire, rente viagère différée, Art.A.335-1, taux intérêt escompté, table mortalité, taux technique, revalorisation éléments rente
8.8 Participation aux bénéfices : Taux PB, base calcul, date attribution, prorata temporis, PB en cours d'année (liquidation/décès/rachat/transfert), fonds collectif
8.9 Garanties : Retraite, décès, rente viagère, réversion, annuités garanties, rente modulable, dépendance, capital, transfert, rachat exceptionnel
8.10 Rachat : Cas légaux (tous les 6 cas), valeur rachat, délai paiement, pièces justificatives
8.11 Décès en constitution : Capital décès, bénéficiaires, clause bénéficiaire, acceptation, revalorisation post-décès
8.12 Liquidation rente : Conditions, demande expresse, âge minimum, pièces nécessaires, versement unique si faible rente
8.13 Calcul rente : Formule complète, variables, taux technique par génération, table par génération, interpolation, fractionnement, coefficients
8.14 Paiement rente : Périodicité, terme, prélèvements, certificat de vie, décès rentier, arrêt
8.15 Options rente : Liste complète, exclusivité, réversion (taux/bénéficiaires), annuités garanties (durée/âge), rente modulable (%, date), dépendance (tarifs H/F)
8.16 Fonds collectifs : Service rentes, revalorisation, alimentation, prélèvements, solde, report, autorité de décision
8.17 Revalorisation : Comptes individuels, éléments rente, rentes servies, dates, critères, décision CA
8.18 Transfert individuel : Conditions, contrats destinataires, valeur, délais, pièces, effet du transfert
8.19 Fiscalité et taxes : Art.83-2 CGI, taxe applicable, charge, prélèvements sociaux, imposition rente/rachat/décès/transfert
8.20 Information assurés : Relevé annuel, date limite, contenu, documents remis
8.21 Prescription, contrôle, médiation, RGPD : Délais prescription, ACPR, réclamation, médiation, responsable traitement
8.22 Inventaire actuariel : PM, capital constitutif, valeur transfert/rachat, produits financiers, taux, hypothèses
8.23 Paramètres techniques : Taux technique par période, TMG, tables mortalité par génération, interpolation, formules complètes avec variables
8.24 Contraintes SI : Pris en charge KELIA/SIP, calcul manuel, paramètre BOSS/KELIA/GAIA, spécificité migration
8.99 Clauses spécifiques produit : TOUT ce qui ne rentre dans aucun des domaines 8.1-8.24 ci-dessus.
     Utilise CE DOMAINE pour ne perdre aucune information atypique, produit-spécifique, ou inhabituelle.
     Exemples : clause de portabilité particulière, mécanisme propre à ce contrat, condition exceptionnelle.
"""

_CARTOGRAPHE_OUTPUT = """{
  "items": [
    {
      "domaine": "<8.x Nom domaine>",
      "sous_domaine": "<sous-domaine précis>",
      "rule_name": "<paramètre atomique exact>",
      "rule_value": "<valeur exacte du document, ou NON TROUVEE, ou A VERIFIER>",
      "rule_unit": "<unité ou null>",
      "condition": "<condition d'application ou null>",
      "source_doc": "<nom document source>",
      "localisation": "<chapitre/article/page>",
      "source_paragraph": "<citation EXACTE du texte source>",
      "type_information": "<Contractuel|Technique|Actuariel|Fiscal|SI/Paramétrage|Gestion|Migration|Recette|Inventaire|Juridique|Donnée de référence|Formule|Exception|A vérifier>",
      "statut_ecart": "<Identique|Différence de formulation|Différence de valeur|Différence de périmètre|Information absente d'une source|A arbitrer métier>",
      "comment": "<commentaire MOA/Actuariat ou null>",
      "impact_parametrage": "<Produit|Garantie|Frais|Versement|Rachat|Transfert|Décès|Rente|Fiscalité|PB/Revalorisation|Fonds collectif|Inventaire|Editique|Workflow|Référentiel|Non applicable|A vérifier>",
      "impact_migration": "<Donnée contrat|Donnée assuré|Donnée bénéficiaire|Donnée versement|Donnée PM|Donnée rente|Donnée fiscalité|Historique nécessaire|Donnée non migrée|Règle cible uniquement|A vérifier>",
      "impact_recette": "<Cas nominal|Cas de bord|Cas réglementaire|Cas fiscal|Cas décès|Cas rachat|Cas transfert|Cas liquidation|Cas rente|Cas PB|Cas revalorisation|Non applicable|A vérifier>",
      "source_page": <numéro de page entier si visible dans le passage (marqueur --- PAGE N --- ou numéro de page dans le texte), sinon null>,
      "confidence": <float 0.0-1.0>
    }
  ],
  "ecarts": [
    {
      "domaine": "<domaine>",
      "rule_name": "<paramètre>",
      "valeur_1": "<valeur source 1>", "source_1": "<doc 1>", "citation_1": "<extrait 1>",
      "valeur_2": "<valeur source 2>", "source_2": "<doc 2>", "citation_2": "<extrait 2>",
      "nature_ecart": "<Différence de valeur|Différence de formulation|Différence de périmètre|Contradiction apparente|Information présente uniquement dans une source>",
      "arbitrage_requis": <true|false>,
      "comment": "<explication>"
    }
  ],
  "formules": [
    {
      "domaine": "<domaine>",
      "nom_formule": "<nom>",
      "formule": "<formule EXACTE telle qu'elle apparaît dans le document>",
      "variables": "<description des variables>",
      "source_doc": "<document>",
      "localisation": "<localisation>",
      "source_paragraph": "<citation exacte>"
    }
  ],
  "points_a_verifier": [
    {
      "domaine": "<domaine>",
      "rule_name": "<paramètre>",
      "probleme": "<description du problème>",
      "source_doc": "<document>",
      "comment": "<commentaire>",
      "priorite": "<Haute|Moyenne|Faible>"
    }
  ],
  "evenements_gestion": [
    {
      "domaine": "<8.x domaine>",
      "evenement": "<nom de l'événement : décès, transfert, liquidation, invalidité, rachat…>",
      "declencheur": "<ce qui déclenche l'événement selon le document>",
      "consequences": ["<effet 1>", "<effet 2>"],
      "formule": "<formule de calcul liée à cet événement si présente, sinon null>",
      "delai": "<délai de traitement ou de paiement si mentionné>",
      "documents_requis": ["<doc 1>", "<doc 2>"],
      "source_paragraph": "<citation EXACTE>",
      "source_page": null
    }
  ],
  "conditions_acces": [
    {
      "domaine": "<8.x domaine>",
      "option_ou_garantie": "<nom de l'option ou garantie>",
      "conditions": "<conditions à remplir pour y accéder>",
      "modalites": "<modalités d'exercice>",
      "effets": "<conséquences sur le contrat>",
      "source_paragraph": "<citation EXACTE>",
      "source_page": null
    }
  ],
  "domaines_vides": ["<8.x Nom domaine>"]
}"""


_CHUNK_SIZE = 14000   # chars par chunk (augmenté pour couvrir plus d'articles par passe)
_CHUNK_OVERLAP = 3000  # overlap large pour ne jamais couper un article en deux


def _split_chunks(text: str) -> list[tuple[int, str]]:
    """
    Semantic chunking à 3 niveaux :
    1. Marqueurs section/page (=== SECTION ===, --- PAGE N ---)
    2. Limites article/clause (Article N, §N, I. II.) — article par article pour CG,
       section par section pour Note Technique
    3. Découpage fixe avec overlap (dernier recours)
    """
    import re as _re2

    # ── Niveau 1 : marqueurs section/page ──────────────────────────────────────
    parts = _re2.split(r'(=== SECTION : .+? ===|--- PAGE \d+ ---)', text)
    chunks: list[tuple[int, str]] = []
    current: str = ""
    idx = 1

    def _flush(buf: str, i: int) -> tuple[str, int]:
        while len(buf) > _CHUNK_SIZE:
            chunks.append((i, buf[:_CHUNK_SIZE]))
            buf = buf[_CHUNK_SIZE - _CHUNK_OVERLAP:]
            i += 1
        return buf, i

    for part in parts:
        if not part:
            continue
        is_marker = bool(_re2.match(r'(=== SECTION : .+? ===|--- PAGE \d+ ---)', part))
        if is_marker:
            if len(current) + len(part) > _CHUNK_SIZE and current.strip():
                current, idx = _flush(current, idx)
                current = current[-_CHUNK_OVERLAP:] if len(current) > _CHUNK_OVERLAP else current
            current += "\n" + part + "\n"
        else:
            if len(current) + len(part) > _CHUNK_SIZE and current.strip():
                current, idx = _flush(current, idx)
                current = current[-_CHUNK_OVERLAP:] if len(current) > _CHUNK_OVERLAP else current
            current += part

    if current.strip():
        while len(current) > _CHUNK_SIZE:
            chunks.append((idx, current[:_CHUNK_SIZE]))
            current = current[_CHUNK_SIZE - _CHUNK_OVERLAP:]
            idx += 1
        chunks.append((idx, current))

    # ── Niveau 2 : article par article (CG) / section par section (NT) ─────────
    if not chunks:
        _ARTICLE_RE = _re2.compile(
            r'(?=\n(?:'
            r'Article\s+\d+|ARTICLE\s+\d+|Art\.\s*\d+|ART\.\s*\d+|'
            r'§\s*\d+|'
            r'\d+\.\s{1,3}[A-ZÀÂÉÈÊËÎÏÔÙÛÜ]|'
            r'\d+\.\d+\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜ]|'
            r'[IVX]{1,4}\.\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜ]'
            r'))',
            _re2.MULTILINE
        )
        articles = _ARTICLE_RE.split(text)
        if len(articles) > 3:
            current_art = ""
            idx = 1
            for article in articles:
                if not article.strip():
                    continue
                if len(current_art) + len(article) > _CHUNK_SIZE and current_art.strip():
                    chunks.append((idx, current_art))
                    idx += 1
                    # Petite queue de contexte pour la continuité
                    current_art = current_art[-600:] + article
                else:
                    current_art += article
            if current_art.strip():
                chunks.append((idx, current_art))

    # ── Niveau 3 : découpage fixe avec overlap (dernier recours) ───────────────
    if not chunks:
        start, idx = 0, 1
        while start < len(text):
            end = start + _CHUNK_SIZE
            chunks.append((idx, text[start:end]))
            if end >= len(text):
                break
            start = end - _CHUNK_OVERLAP
            idx += 1

    return chunks


import re as _re

# ---------------------------------------------------------------------------
# Vocabulaire standardisé — noms de règles canoniques pour la cohérence cross-docs
# ---------------------------------------------------------------------------

_DECOMPOSITION_FRAMEWORK = """
═══ DÉCOMPOSITION OBLIGATOIRE PAR GARANTIE / MÉCANISME ═══

Pour chaque garantie, mécanisme, ou bloc fonctionnel identifié dans le passage,
tu DOIS systématiquement chercher et renseigner (ou indiquer l'absence de) :

1. DÉFINITION — Qu'est-ce que cette garantie/mécanisme ? Quelle est sa nature ?

2. CONDITIONS D'ÉLIGIBILITÉ — Qui peut en bénéficier ?
   (âge, ancienneté, statut, conditions requises à l'entrée)

3. CONDITIONS DE DÉCLENCHEMENT — Qu'est-ce qui active la garantie ?
   (événement déclencheur, délai de carence, seuil, demande expresse)

4. EFFETS DE GESTION — Que se passe-t-il concrètement ?
   (actions sur le contrat, sur les droits, sur les montants)

5. PARAMÈTRES CHIFFRÉS — Extraire SYSTÉMATIQUEMENT même noyés dans le texte :
   taux | pourcentages | plafonds | montants | âges | durées | délais |
   franchises | coefficients | barèmes | seuils | périodicités

6. FORMULES — Si une formule est présente : la retranscrire TELLE QUELLE avec ses variables.
   Si mentionnée mais non détaillée → rule_value = "Formule mentionnée mais non détaillée"
   → Créer une entrée dans "formules" ET une entrée dans "items"

7. BARÈMES — Identifier tous les barèmes, tarifs, tables de valeur.
   Ex : Tarif dépendance Homme = 7%, Femme = 10% → une entrée par ligne de barème.

8. CONTRAINTES SI — Identifier calcul manuel, calcul hors système, traitement spécifique,
   workflow particulier, limitation de l'outil de gestion.
   → Toujours catégoriser dans 8.24 Contraintes SI.

9. PARAMÈTRES TECHNIQUES — Dates de valeur, dates d'effet, périodicités, règles de
   reconduction, fréquence de traitement, modalités de versement, délais réglementaires.

10. AUTRES INFORMATIONS — Ce document peut contenir des informations que ce cadre ne prévoit
    pas. Tu dois les capturer dans la catégorie la plus pertinente (8.1-8.24 ou 8.99).
    JAMAIS ignorer une information sous prétexte qu'elle sort de ce cadre.

VÉRIFICATION FINALE PAR GARANTIE :
Après extraction, vérifier que chaque garantie identifiée renseigne (ou signale l'absence de) :
✓ Définition  ✓ Conditions d'accès  ✓ Conditions de sortie  ✓ Paramètres chiffrés
✓ Tarification  ✓ Formule  ✓ Contraintes SI  ✓ Exceptions  ✓ Cas particuliers

Si un élément est absent du document → rule_value = "NON TROUVEE DANS CE DOCUMENT"
Ne jamais conclure qu'une information n'existe pas sans avoir lu l'ensemble du passage.
"""

_STANDARD_RULE_NAMES = """
VOCABULAIRE STANDARDISÉ — GUIDE DE NOMMAGE (pas une liste exhaustive) :
Utilise ces libellés comme rule_name QUAND ils correspondent à ce que tu lis dans le document.
Si l'information ne correspond à aucun libellé → crée ton propre libellé précis et factuel.
Ce vocabulaire harmonise les noms entre documents (CG / NT / Fiche BOSS) pour détecter les incohérences.
Il ne limite PAS l'extraction — tu dois TOUT capturer, même ce qui est hors liste.

8.1 IDENTIFICATION PRODUIT :
  Nom commercial du produit | Libellé commercial | Numéro de CG | Version des CG | Date de version des CG
  | Nature du contrat (individuel/collectif) | Type d'adhésion (obligatoire/facultatif/mixte)
  | Branche d'assurance | Article fiscal principal | Article fiscal secondaire
  | Statut de commercialisation | Date de fermeture à la vente
  | Assureur | Code assureur | Siège social assureur
  | Souscripteur | Nature du souscripteur | Gestionnaire | Équipe de gestion
  | Code produit SI source | Code produit SI cible | Codes produits historiques
  | SI source | SI cible | Éditeur SI cible | Date de migration SI
  | Réseau de distribution | Période de commercialisation début | Période de commercialisation fin
  | Encours du contrat | Collecte annuelle | Nombre d'assurés

8.1b SUPPORTS FINANCIERS (UC / Fonds euros) :
  Support financier (euros/UC/mixte) | Actif général ou cantonné | Nombre de compartiments
  | Liste des supports UC disponibles | Classification AMF des supports UC
  | Profils de gestion pilotée disponibles | Gestion libre disponible
  | Arbitrages automatiques disponibles | Fréquence d'arbitrage | Seuil minimum d'arbitrage
  | Garantie plancher décès sur UC | Garantie cliquet sur UC
  | Unité de compte immobilière présente | Fonds en euros disponible

8.2 DURÉE / VIE DU CONTRAT :
  Durée initiale | Conditions résiliation souscripteur | Préavis résiliation | Droits acquis résiliation
  | Maintien PB après résiliation | Conditions résiliation assureur
  | Défaut paiement — relance | Défaut paiement — délai avant suspension
  | Défaut paiement — délai avant résiliation après suspension

8.3 ASSURÉS : Affiliation obligatoire | Population bénéficiaire | Nouvelles affiliations | Obligations entreprise

8.4 COTISATIONS / VERSEMENTS :
  Assiette cotisation | Tranches cotisation (TA/TB/TC/TD) | Taux cotisation par tranche
  | Taux minimum contractuel cotisation | Périodicité cotisations
  | Versements libres autorisés | Montant minimum versement libre
  | Versements CET autorisés | Versements intéressement autorisés | Versements participation autorisés
  | Transferts entrants autorisés | Type contrats acceptés en transfert entrant

8.5 DATES DE VALEUR :
  Date de valeur cotisation avant 15 du mois | Date de valeur cotisation après 15 du mois
  | Date de valeur versement libre | Date de valeur versement CET | Date de valeur transfert entrant
  | Date de valeur rachat | Date de valeur capital décès | Date de valeur transfert sortant
  | Date d'effet rente | Condition âge minimum liquidation | Condition liquidation régime obligatoire requise
  | Prorogation date d'effet possible | Délai maximum prorogation

8.6 FRAIS :
  Frais sur cotisations obligatoires | Frais sur versements libres | Frais sur versements CET
  | Frais sur transferts entrants | Frais gestion encours | Base calcul frais gestion encours
  | Frais sur arrérages rente | Frais gestion rentes | Frais transfert sortant | Frais sur rachats
  | Frais d'arbitrage UC | Taxe sur cotisations (TCA) | Taux TCA | Charge TCA (souscripteur/salarié)

8.7 CONSTITUTION DES DROITS :
  Mécanisme constitution droits (éléments de rente ou valeur de compte)
  | Génération de strate par versement | Paramètres de strate (taux technique + table)
  | Mécanisme strates | Définition strate | Affectation versements aux strates
  | Rachat — ordre de sortie strates | Taux intérêt escompté
  | Table mortalité constitution | Taux technique en vigueur

8.8 PARTICIPATION AUX BÉNÉFICES :
  Taux PB financier | Base calcul PB (produits financiers nets ou bruts)
  | Déduction frais de gestion dans la PB | Date attribution PB | Effet rétroactif PB
  | Taux PB provisoire en cours d'année | Base taux provisoire (moyenne N exercices)
  | Nombre exercices retenus taux provisoire | Pourcentage appliqué taux provisoire
  | Cas déclencheurs taux provisoire
  | Fonds collectif de revalorisation existant | Périmètre fonds revalorisation
  | Fonds collectif service rentes existant | Périmètre fonds service rentes
  | Alimentation crédit fonds service | Alimentation débit fonds service
  | Mécanisme lissage inter-exercices
  | PB en cours d'année — rachat | PB en cours d'année — décès
  | PB en cours d'année — transfert | PB en cours d'année — liquidation

8.10 RACHAT :
  Disponibilité épargne avant retraite | Nombre de cas de rachat autorisés
  | Rachat autorisé cas 1 — décès conjoint ou PACS
  | Rachat autorisé cas 2 — invalidité 2e ou 3e catégorie
  | Rachat autorisé cas 3 — licenciement / chômage fin droits
  | Rachat autorisé cas 4 — liquidation judiciaire
  | Rachat autorisé cas 5 — cessation activité non salariée / mandat social
  | Rachat autorisé cas 6 — surendettement
  | Valeur de rachat | Date calcul valeur de rachat | Délai paiement rachat
  | Pièces justificatives rachat | Montant rachat (total ou partiel)
  | Seuil faible rente — annuel | Seuil faible rente — trimestriel
  | Référence réglementaire seuil faible rente | Faible rente — montant versement unique

8.11 DÉCÈS EN CONSTITUTION :
  Garantie décès en phase de constitution | Capital décès
  | Revalorisation capital décès entre décès et paiement | Référence légale revalorisation post-décès
  | Dépôt CDC en cas de non-réclamation
  | Clause bénéficiaire niveau 1 | Clause bénéficiaire niveau 2
  | Clause bénéficiaire niveau 3 | Clause bénéficiaire niveau 4
  | Acceptation bénéficiaire possible | Forme acceptation bénéficiaire
  | Délai renonciation à l'acceptation

8.12 LIQUIDATION RENTE :
  Condition liquidation rente | Demande expresse requise | Âge minimum liquidation
  | Pièces requises liquidation | Faible rente — seuil déclenchement versement unique
  | Faible rente — versement unique calculé comment

8.13 CALCUL RENTE :
  Formule calcul rente | Variables formule rente
  | Table mortalité rente | Date application table mortalité rente
  | Taux technique rente | Calcul par interpolation ou par âge arrondi
  | Fractionnement de la rente | Coefficients de fractionnement

8.14 PAIEMENT RENTE :
  Périodicité paiement rente | Terme paiement rente (échu ou à échoir)
  | Prorata décès rentier | Certificat de vie — requis | Certificat de vie — périodicité

8.15 OPTIONS RENTE :
  Nombre d'options de rente proposées | Exclusivité des options | Irrévocabilité du choix d'option
  | Option réversion — taux disponibles | Bénéficiaires réversion | Nombre de têtes réversion possible
  | Réversion mono-tête — prise en charge SI | Réversion multi-têtes — prise en charge SI
  | Réversion multi-têtes — outil calcul alternatif | Règle calcul part réversion par ex-conjoint
  | Base d'âge réversion mono-tête (âge exact) | Base d'âge réversion multi-têtes (âge arrondi)
  | Date d'effet rente de réversion | Obligation prise en compte ex-conjoints (L.912-4)
  | Option annuités garanties — disponible | Condition âge pour annuités garanties
  | Option annuités garanties — durées selon âge < 70 ans
  | Option annuités garanties — durées selon âge 70-75 ans
  | Option annuités garanties — prise en charge SI
  | Option annuités garanties — outil calcul alternatif
  | Option annuités garanties — bénéficiaire décès pendant période garantie
  | Option rente modulable — disponible | Option rente modulable — paliers de modulation
  | Option rente modulable — anniversaires de modulation | Option rente modulable — prise en charge SI
  | Option rente modulable — outil calcul alternatif
  | Option dépendance — disponible | Option dépendance — condition d'âge
  | Option dépendance — définition couverte (totale/partielle)
  | Option dépendance — effet sur la rente (multiplicateur)
  | Option dépendance — plafond rente trimestrielle | Option dépendance — délai de carence
  | Option dépendance — tarif homme | Option dépendance — tarif femme
  | Option dépendance — prise en charge SI | Option dépendance — questionnaire médical requis

8.16 FONDS COLLECTIFS :
  Fonds service rentes — alimentation crédit | Fonds service rentes — alimentation débit
  | Fonds revalorisation — alimentation | Autorité décision revalorisation
  | Critères revalorisation | Date revalorisation rentes servies

8.17 REVALORISATION :
  Revalorisation comptes individuels | Revalorisation éléments rente
  | Revalorisation rentes servies | Date décision revalorisation

8.18 TRANSFERT INDIVIDUEL :
  Transfert sortant autorisé | Conditions transfert sortant | Valeur de transfert — méthode de calcul
  | Délai notification valeur de transfert | Délai renonciation au transfert
  | Délai versement à l'organisme d'accueil | Contrats éligibles au transfert sortant
  | VIF libres après départ entreprise

8.19 FISCALITÉ :
  Article fiscal principal (83/82/39/PERO) | Régime social cotisations
  | Régime fiscal rente | Régime fiscal rachat | Régime fiscal décès
  | Prélèvements sociaux | Taxe applicable | Compteur fiscal IFU requis
  | Ventilation par taux garanti requise

8.20 INFORMATION ASSURÉS :
  Relevé annuel — obligatoire | Relevé annuel — date limite d'envoi
  | Relevé annuel — contenu | Relevé annuel — granularité par versement
  | Bulletin de situation disponible | Documents remis à l'assuré

8.21 PRESCRIPTION / MÉDIATION :
  Prescription biennale — actions sur le contrat | Prescription décennale — bénéficiaire tiers
  | Prescription maximale — décès assuré | Médiation — organisme | Réclamations — coordonnées

8.22 INVENTAIRE ACTUARIEL :
  PM fin d'exercice | Capital constitutif rente | Produits financiers
  | Hypothèses actuarielles | Qualité des données SI source

8.23 PARAMÈTRES TECHNIQUES :
  Taux minimum garanti (TMG) | TMG net ou brut | TMG par génération ou unique
  | Date de début TMG | Date de fin TMG | Historique taux techniques par période
  | Table mortalité applicable | Date changement table mortalité
  | Table mortalité antérieure | Table mortalité prospective ou pas
  | Taux technique avant 2007 | Taux technique au 01/08/2016
  | Calcul par interpolation ou par âge arrondi

8.24 CONTRAINTES SI :
  Calcul manuel hors SIP | Paramètre BOSS | Paramètre KELIA | Contrainte migration
  | Contrats en état non standard | Compteurs fiscaux incomplets
  | Données sexe assuré disponibles | Historique données SI antérieur disponible
  | Codes SIP à mapper | Qualité données SI source
"""


_ART83_PB_RULE = """
RÈGLE CRITIQUE — PARTICIPATION AUX BÉNÉFICES (2 taux distincts, NE JAMAIS CONFONDRE) :

▸ rule_name = "Taux PB annuel"
  = taux contractuel attribué chaque année à l'ensemble des assurés (souvent 100% des produits financiers nets)

▸ rule_name = "Taux PB provisoire en cours d'année"
  = taux estimé appliqué aux événements ponctuels uniquement (liquidation, décès, rachat, transfert)
  Formulation typique : "X% de la moyenne des N derniers exercices connus"

EXEMPLE NÉGATIF :
  DOCUMENT : "100% des produits financiers nets [...] 85% de la moyenne des deux derniers exercices"
  ERREUR : Taux PB annuel = 85%
  CORRECT : Taux PB annuel = 100% | Taux PB provisoire = 85% × moyenne(N-1, N-2)
  POURQUOI : 85% est provisoire (événements ponctuels). 100% est le taux contractuel annuel.
  Si tes deux valeurs sont identiques → tu as fait une erreur, relire le document.
"""

_ART83_RACHAT_RULE = """
INVARIANT ART.83 — 6 CAS DE RACHAT LÉGAUX (chercher et documenter chacun) :
  Cas 1 — Décès du conjoint ou partenaire PACS
  Cas 2 — Invalidité 2e ou 3e catégorie (assuré, conjoint, ou enfant à charge)
  Cas 3 — Licenciement / fin droits chômage ARE
  Cas 4 — Liquidation judiciaire / cessation mandat social non renouvelé
  Cas 5 — Surendettement (L.330-1 Code de la consommation)
  Cas 6 — Expiration des droits à l'assurance chômage
Si tu trouves moins de 3 cas → ajouter dans "points_a_verifier" : "ALERTE : < 3 cas de rachat trouvés — vérifier l'article rachat"
"""

_ART83_CHECKLIST = """
INFORMATIONS SOUVENT MANQUANTES SUR ART.83 — chercher activement :
1. Principe d'indisponibilité : rule_name="Principe d'indisponibilité épargne", rule_value="OUI — sauf cas légaux"
2. PB prorata temporis : rule_name="PB — règle de proratisation", documenter la formule exacte
3. Réversion multi-têtes âge arrondi : rule_name="Base d'âge réversion multi-têtes", rule_value="Âge arrondi entier (pas d'interpolation)"
   + entrée 8.24 : rule_name="Contrainte SI — réversion multi-têtes", rule_value="Calcul manuel — hors SI"
4. Codes SI historiques (page de garde NT) : rule_name="Code produit SI [nom]", rule_value="[le code]"
5. Préavis résiliation : documenter DÉLAI + FORME (LRAR ?) + DATE ÉCHÉANCE (31/12 ?)
6. Prescription 3 délais distincts :
   - rule_name="Délai prescription — actions sur contrat" (typiquement 2 ans)
   - rule_name="Délai prescription — bénéficiaire personne distincte" (typiquement 10 ans)
   - rule_name="Délai prescription — après décès assuré" (typiquement 30 ans)
7. Effets juridiques transfert : rule_name="Effet juridique du transfert", rule_value="Extinction des droits dans le contrat d'origine"
"""


_NT_CHECKLIST = """
CHECKLIST NOTE TECHNIQUE — thématiques à couvrir SYSTÉMATIQUEMENT (chercher dans chaque chunk) :

⚠ RÈGLE DE GRANULARITÉ ABSOLUE : une phrase avec N faits distincts = N items distincts.
  Exemples :
  "valable jusqu'au 31/12 [FAIT 1]. Il se renouvelle par tacite reconduction [FAIT 2]."
   → item 1 : rule_name="Durée du contrat", rule_value="jusqu'au 31 décembre de l'exercice d'effet"
   → item 2 : rule_name="Renouvellement tacite", rule_value="d'année en année par tacite reconduction"
  "versée au 1er juillet [FAIT 1] avec effet rétroactif au 1er janvier [FAIT 2]"
   → item 1 : rule_name="Date de versement PB annuel", rule_value="1er juillet de chaque année"
   → item 2 : rule_name="PB — effet rétroactif", rule_value="effet rétroactif au 1er janvier de l'exercice"

8.1  Identification / Particularités du contrat
  → rule_name="Type de contrat — mécanisme", rule_value="contrat en éléments de rente" si applicable
  → rule_name="Constitution des droits — mécanisme" : chaque versement transformé en élément de rente
  → rule_name="Génération de taux technique" : taux au moment du versement (pas à la liquidation)
  → rule_name="Génération de table de mortalité" : table au moment du versement
  → rule_name="Particularités contractuelles" : toute clause non standard

8.2  Durée et vie du contrat
  → rule_name="Durée du contrat" (date d'échéance contractuelle)
  → rule_name="Renouvellement tacite" (si "tacite reconduction" ou "renouvellement automatique" dans le texte)
  → rule_name="Conditions de résiliation", rule_name="Préavis résiliation"

8.5  Dates de valeur (seulement les dates qui régissent les flux financiers)
  → rule_name="Date de valeur cotisation avant le 15 du mois"
  → rule_name="Date de valeur cotisation après le 15 du mois"
  → rule_name="Date de valeur rachat", rule_name="Date de valeur transfert"

8.6  Frais
  → rule_name="Frais de souscription / chargement à l'entrée" (taux et base)
  → rule_name="Frais de gestion annuels" (taux et base de calcul)
  → rule_name="Frais sur arrérages" (taux et périodicité)
  → rule_name="Frais de transfert sortant" (taux ou forfait)
  → rule_name="Frais de transfert entrant"

8.8  Participation aux bénéfices
  → rule_name="Taux PB annuel" (taux contractuel attribué annuellement)
  → rule_name="Date de versement PB annuel" : date exacte de versement (ex: "1er juillet")
  → rule_name="PB — effet rétroactif" : date de prise d'effet (ex: "1er janvier")
  → rule_name="Taux PB provisoire en cours d'année" (pour événements : décès, rachat, transfert)
  → rule_name="Base de calcul PB" (produits financiers nets, frais déduits, etc.)
  → rule_name="Base de référence PB provisoire" (ex: "moyenne des taux des 2 derniers exercices")

8.10 Valeurs de rachat
  → rule_name="Valeur de rachat — formule de calcul"
  → rule_name="Délai de paiement rachat"
  → Pour chacun des cas : rule_name="Rachat autorisé — Cas [N] : [libellé exact]"

8.12 Liquidation de la rente (DATE D'EFFET — chercher dans section "Date de valeur" aussi)
  → rule_name="Date d'effet rente — âge minimum" (ex: "1er jour du trimestre civil qui suit le 60ème anniversaire")
  → rule_name="Date d'effet rente — retraite anticipée" (si taux plein SS avant l'âge minimum)
  → rule_name="Prorogation date d'effet rente — conditions" (possible si SS non liquidée)
  → rule_name="Prorogation date d'effet rente — délai maximal" (ex: "au plus tard dans les 6 mois")
  → rule_name="Date d'effet rente — défaut après délai" (ex: "1er jour du trimestre de la demande")
  → rule_name="Formule de calcul de la rente" (formule exacte)
  → rule_name="Tables de mortalité utilisées"
  → rule_name="Taux technique" (valeur + génération si applicable)
  → rule_name="Terme de la rente" (échu / à échoir)
  → rule_name="Seuil de faible rente" (seuil déclenchant versement unique)

8.15 Options de rente (documenter CHAQUE option disponible)
  → rule_name="Option réversion — taux", rule_name="Option réversion — bénéficiaires"
  → rule_name="Option annuités garanties — durée(s) selon âge"
  → rule_name="Option rente modulable — modalités"
  → rule_name="Option dépendance — déclencheur", rule_name="Option dépendance — majoration"
  → rule_name="Base d'âge — réversion multi-têtes" (âge arrondi / interpolé)

8.17 Revalorisation de la rente
  → rule_name="Taux de revalorisation garanti" (plancher)
  → rule_name="Mécanisme de revalorisation" (PB sur fonds de service, taux technique, etc.)
  → rule_name="Fonds de service / fonds de revalorisation" (s'il existe)
"""


def _is_art83_context(text_sample: str) -> bool:
    s = text_sample[:3000].lower()
    return any(x in s for x in ["article 83", "art.83", "art. 83", "83-2 ", "retraite collective", "l.224-"])


def _detect_doc_type(document_name: str) -> str:
    """Detect document type from filename for Cartographe context."""
    n = document_name.lower()
    if any(x in n for x in ("conditions générales", "conditions generales", " cg ", "cg_", "_cg.", "02 cg")):
        return (
            "CONDITIONS GÉNÉRALES — document contractuel structuré en ARTICLES NUMÉROTÉS. "
            "OBLIGATION : parcourir chaque article de ce passage sans exception. "
            "Pour chaque article, appliquer la décomposition complète : "
            "définition, conditions d'éligibilité, conditions de déclenchement, effets de gestion, "
            "paramètres chiffrés, barèmes, contraintes SI, exceptions, cas particuliers. "
            "Les articles sur le RACHAT doivent produire 6 entrées (6 cas légaux). "
            "Les articles sur les OPTIONS RENTE doivent produire une entrée par option. "
            "Un article administratif (résiliation, prescription) = au minimum ses délais et conditions."
        )
    if any(x in n for x in ("note technique", "nt ", "_nt", "nt_", "01 note", "note_tech")):
        return (
            "NOTE TECHNIQUE — document actuariel et de paramétrage. "
            "Priorité ABSOLUE sur : formules de calcul (rente, PM, capital constitutif), "
            "tables de mortalité (références, dates d'application, interpolation), "
            "taux techniques par période, TMG, hypothèses actuarielles, barèmes (dépendance, options rente), "
            "contraintes SI (calcul manuel, hors système), paramètres BOSS/KELIA/GAIA. "
            "Ce document est souvent LA SOURCE des paramètres chiffrés — chaque chiffre compte. "
            "Applique la décomposition garantie par garantie (définition, conditions, effets, paramètres, formule, SI)."
        )
    if any(x in n for x in ("parametrage", "paramétrage", "boss", "fiche_param", "fiche param")):
        return "FICHE DE PARAMÉTRAGE BOSS — document SI avec paramètres BOSS/KELIA structurés par domaine."
    if any(x in n for x in ("cr atelier", "cr_atelier", "compte rendu", "atelier", "05 cr")):
        return "COMPTE RENDU D'ATELIER — décisions et points de validation issus de réunions. Priorité : valeurs arrêtées, décisions, points en suspens."
    if any(x in n for x in ("avenant", "annexe")):
        return "AVENANT / ANNEXE — modification ou complément au contrat principal. Priorité : les valeurs de cet avenant priment sur les CG pour les domaines couverts."
    return "DOCUMENT PRODUIT"


def _parse_source_page(item: dict) -> int | None:
    """Extract page number from item: explicit source_page field first, then localisation regex."""
    explicit = item.get("source_page")
    if explicit is not None:
        try:
            return int(explicit)
        except (ValueError, TypeError):
            pass
    loc = item.get("localisation") or ""
    m = _re.search(r"(?:p\.|page|page\s+|PAGE\s+)(\d+)", loc, _re.IGNORECASE)
    if m:
        return int(m.group(1))
    return None


# Mapping des variantes de catégories vers les noms canoniques 8.x
_CATEGORY_ALIASES: dict[str, str] = {
    # snake_case old-style
    "rachat": "8.10 Rachat",
    "deces": "8.11 Décès en constitution",
    "décès": "8.11 Décès en constitution",
    "transfert": "8.18 Transfert individuel",
    "transfert_individuel": "8.18 Transfert individuel",
    "liquidation_rente": "8.12 Liquidation rente",
    "liquidation": "8.12 Liquidation rente",
    "calcul_rente": "8.13 Calcul rente",
    "paiement_rente": "8.14 Paiement rente",
    "options_rente": "8.15 Options rente",
    "fonds_collectifs": "8.16 Fonds collectifs",
    "revalorisation": "8.17 Revalorisation",
    "fiscalite": "8.19 Fiscalité et taxes",
    "fiscalité": "8.19 Fiscalité et taxes",
    "cotisations": "8.4 Cotisations et versements",
    "versements": "8.4 Cotisations et versements",
    "frais": "8.6 Frais",
    "dates_de_valeur": "8.5 Dates de valeur",
    "identification": "8.1 Identification produit",
    "identification_produit": "8.1 Identification produit",
    "pb": "8.8 Participation aux bénéfices",
    "pb_participation_benefices": "8.8 Participation aux bénéfices",
    "participation_aux_benefices": "8.8 Participation aux bénéfices",
    "participation_aux_bénéfices": "8.8 Participation aux bénéfices",
    "constitution_droits": "8.7 Constitution des droits",
    "mecanisme_strates": "8.7 Constitution des droits",
    "mécanisme_strates": "8.7 Constitution des droits",
    "garanties": "8.9 Garanties",
    "information_assures": "8.20 Information assurés",
    "information_assurés": "8.20 Information assurés",
    "prescription": "8.21 Prescription",
    "inventaire": "8.22 Inventaire actuariel",
    "parametres_techniques": "8.23 Paramètres techniques",
    "paramètres_techniques": "8.23 Paramètres techniques",
    "contraintes_si": "8.24 Contraintes SI",
    "points_attention_sip": "8.24 Contraintes SI",
    "points_attention_si": "8.24 Contraintes SI",
    "formule": "8.13 Calcul rente",
    "clauses_specifiques": "8.99 Clauses spécifiques produit",
    # hors scope → mapper vers 8.99 pour ne pas les perdre mais les signaler
    "arbitrages": "8.99 Clauses spécifiques produit",
    "gestion_pilotee": "8.99 Clauses spécifiques produit",
    "gestion_pilotée": "8.99 Clauses spécifiques produit",
    "supports_uc": "8.99 Clauses spécifiques produit",
    "garantie_plancher_uc": "8.99 Clauses spécifiques produit",
    "ppb": "8.99 Clauses spécifiques produit",
    "actes_de_gestion": "8.99 Clauses spécifiques produit",
}

# Domains that map 8.x prefix → canonical name
_CANONICAL_8X = {
    "8.1": "8.1 Identification produit",
    "8.2": "8.2 Durée et vie du contrat",
    "8.3": "8.3 Assurés et souscription",
    "8.4": "8.4 Cotisations et versements",
    "8.5": "8.5 Dates de valeur",
    "8.6": "8.6 Frais",
    "8.7": "8.7 Constitution des droits",
    "8.8": "8.8 Participation aux bénéfices",
    "8.9": "8.9 Garanties",
    "8.10": "8.10 Rachat",
    "8.11": "8.11 Décès en constitution",
    "8.12": "8.12 Liquidation rente",
    "8.13": "8.13 Calcul rente",
    "8.14": "8.14 Paiement rente",
    "8.15": "8.15 Options rente",
    "8.16": "8.16 Fonds collectifs",
    "8.17": "8.17 Revalorisation",
    "8.18": "8.18 Transfert individuel",
    "8.19": "8.19 Fiscalité et taxes",
    "8.20": "8.20 Information assurés",
    "8.21": "8.21 Prescription",
    "8.22": "8.22 Inventaire actuariel",
    "8.23": "8.23 Paramètres techniques",
    "8.24": "8.24 Contraintes SI",
    "8.99": "8.99 Clauses spécifiques produit",
}


def _canonicalize_category(raw: str) -> str:
    """Normalize any category variant to canonical '8.x Name' form."""
    if not raw:
        return "8.99 Clauses spécifiques produit"
    s = raw.strip()
    # Already in canonical 8.x form
    m = _re.match(r"^(8\.\d+)", s)
    if m:
        prefix = m.group(1)
        return _CANONICAL_8X.get(prefix, s)
    # Known alias
    key = s.lower().replace(" ", "_").replace("-", "_")
    if key in _CATEGORY_ALIASES:
        return _CATEGORY_ALIASES[key]
    # Try without accents
    import unicodedata as _ud
    nfkd = _ud.normalize("NFKD", key)
    no_acc = "".join(c for c in nfkd if not _ud.combining(c))
    if no_acc in _CATEGORY_ALIASES:
        return _CATEGORY_ALIASES[no_acc]
    return s  # keep original if unknown


def _normalise_cartographe_result(result: dict) -> list[dict]:
    """Convert raw Cartographe JSON output to internal referentiel schema."""
    normalised: list[dict] = []

    for it in result.get("items", []):
        rv = it.get("rule_value") or ""
        rv_lower = rv.strip().lower()

        # Skip items where rule_value is a noise/no-value marker
        if any(m in rv_lower for m in _NO_VALUE_MARKERS):
            continue

        src = (it.get("source_paragraph") or "").strip()
        raw_conf = float(it.get("confidence") or 0.9)
        # Items with "NON TROUVEE DANS CE DOCUMENT" are kept but confidence forced to 0.0
        if "non trouvee dans ce document" in rv_lower:
            confidence = 0.0
        # Source obligatoire : si absente, confiance forcée à 0.1
        elif src and src != "Source non identifiée":
            confidence = raw_conf
        else:
            confidence = min(raw_conf, 0.1)
        meta = {
            "sous_domaine": it.get("sous_domaine"),
            "condition": it.get("condition"),
            "localisation": it.get("localisation"),
            "type_information": it.get("type_information"),
            "statut_ecart": it.get("statut_ecart"),
            "impact_parametrage": it.get("impact_parametrage"),
            "impact_migration": it.get("impact_migration"),
            "impact_recette": it.get("impact_recette"),
            "comment_moa": it.get("comment"),
        }
        normalised.append({
            "category": _canonicalize_category(it.get("domaine", "")),
            "rule_name": it.get("rule_name", ""),
            "rule_value": rv if rv else NO_VALUE,
            "rule_unit": it.get("rule_unit"),
            "source_paragraph": src if src else None,
            "source_page": _parse_source_page(it),
            "confidence": confidence,
            "comment": json.dumps(meta, ensure_ascii=False),
            "conflict": False,
        })

    for ec in result.get("ecarts", []):
        meta_ec = {
            "nature_ecart": ec.get("nature_ecart"),
            "valeur_1": ec.get("valeur_1"), "source_1": ec.get("source_1"),
            "valeur_2": ec.get("valeur_2"), "source_2": ec.get("source_2"),
            "arbitrage_requis": ec.get("arbitrage_requis"),
            "comment_moa": ec.get("comment"),
            "type_information": "A vérifier",
            "impact_parametrage": "A vérifier",
            "impact_migration": "A vérifier",
            "impact_recette": "A vérifier",
        }
        normalised.append({
            "category": _canonicalize_category(ec.get("domaine", "")),
            "rule_name": ec.get("rule_name", "") + " [ÉCART]",
            "rule_value": f"{ec.get('valeur_1','')} / {ec.get('valeur_2','')}",
            "rule_unit": None,
            "source_paragraph": f"{ec.get('citation_1','')} | {ec.get('citation_2','')}",
            "confidence": 0.6,
            "comment": json.dumps(meta_ec, ensure_ascii=False),
            "conflict": True,
        })

    for fm in result.get("formules", []):
        meta_fm = {
            "nom_formule": fm.get("nom_formule"),
            "variables": fm.get("variables"),
            "localisation": fm.get("localisation"),
            "type_information": "Formule",
            "impact_parametrage": "Rente",
            "impact_migration": "A vérifier",
            "impact_recette": "Cas rente",
        }
        normalised.append({
            "category": _canonicalize_category(fm.get("domaine", "8.13 Calcul rente")),
            "rule_name": fm.get("nom_formule", "Formule"),
            "rule_value": fm.get("formule", "FORMULE ILLISIBLE"),
            "rule_unit": None,
            "source_paragraph": fm.get("source_paragraph"),
            "confidence": 0.95,
            "comment": json.dumps(meta_fm, ensure_ascii=False),
            "conflict": False,
        })

    for pv in result.get("points_a_verifier", []):
        meta_pv = {
            "probleme": pv.get("probleme"),
            "priorite": pv.get("priorite"),
            "comment_moa": pv.get("comment"),
            "type_information": "A vérifier",
            "impact_parametrage": "A vérifier",
            "impact_migration": "A vérifier",
            "impact_recette": "A vérifier",
        }
        normalised.append({
            "category": _canonicalize_category(pv.get("domaine", "")),
            "rule_name": pv.get("rule_name", "Point à vérifier"),
            "rule_value": "A VERIFIER",
            "rule_unit": None,
            "source_paragraph": pv.get("source_doc"),
            "confidence": 0.3,
            "comment": json.dumps(meta_pv, ensure_ascii=False),
            "conflict": False,
        })

    # Événements de gestion → items dans leur domaine avec type_information="Gestion"
    for ev in result.get("evenements_gestion", []):
        consequences = " | ".join(ev.get("consequences") or [])
        docs_requis = " | ".join(ev.get("documents_requis") or [])
        rule_value = consequences or ev.get("declencheur", "")
        if ev.get("formule"):
            rule_value = f"{rule_value} — Formule : {ev['formule']}"
        if ev.get("delai"):
            rule_value = f"{rule_value} — Délai : {ev['delai']}"
        if not rule_value or _is_noise(rule_value):
            continue
        meta_ev = {
            "declencheur": ev.get("declencheur"),
            "consequences": ev.get("consequences"),
            "formule": ev.get("formule"),
            "delai": ev.get("delai"),
            "documents_requis": docs_requis,
            "type_information": "Gestion",
            "impact_parametrage": "Workflow",
            "impact_migration": "A vérifier",
            "impact_recette": f"Cas {ev.get('evenement', '')}",
        }
        sp = ev.get("source_paragraph", "")
        normalised.append({
            "category": _canonicalize_category(ev.get("domaine", "8.99 Clauses spécifiques produit")),
            "rule_name": f"Événement — {ev.get('evenement', 'Gestion')}",
            "rule_value": rule_value,
            "rule_unit": None,
            "source_paragraph": sp if sp else "Source non identifiée",
            "source_page": ev.get("source_page"),
            "confidence": 0.85 if sp else 0.1,
            "comment": json.dumps(meta_ev, ensure_ascii=False),
            "conflict": False,
        })

    # Conditions d'accès → items dans leur domaine avec type_information="Contractuel"
    for ca in result.get("conditions_acces", []):
        rule_value = ca.get("conditions", "")
        if ca.get("modalites"):
            rule_value = f"{rule_value} — Modalités : {ca['modalites']}"
        if ca.get("effets"):
            rule_value = f"{rule_value} — Effets : {ca['effets']}"
        if not rule_value or _is_noise(rule_value):
            continue
        meta_ca = {
            "conditions": ca.get("conditions"),
            "modalites": ca.get("modalites"),
            "effets": ca.get("effets"),
            "type_information": "Contractuel",
            "impact_parametrage": "Garantie",
            "impact_migration": "A vérifier",
            "impact_recette": "Cas de bord",
        }
        sp = ca.get("source_paragraph", "")
        normalised.append({
            "category": _canonicalize_category(ca.get("domaine", "8.99 Clauses spécifiques produit")),
            "rule_name": f"Condition accès — {ca.get('option_ou_garantie', 'Option')}",
            "rule_value": rule_value,
            "rule_unit": None,
            "source_paragraph": sp if sp else "Source non identifiée",
            "source_page": ca.get("source_page"),
            "confidence": 0.85 if sp else 0.1,
            "comment": json.dumps(meta_ca, ensure_ascii=False),
            "conflict": False,
        })

    return normalised


def _extract_document_sections(text: str) -> list[str]:
    """
    Parse all === SECTION : ... === markers from extracted text.
    Returns the ordered list of section titles found in the document.
    This is zero-LLM — purely structural, based on extraction markers.
    """
    import re as _re3
    titles = _re3.findall(r'=== SECTION : (.+?) ===', text)
    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for t in titles:
        t = t.strip()
        if t and t not in seen:
            seen.add(t)
            unique.append(t)
    return unique


_SINGLE_SHOT_THRESHOLD = 20_000  # docs <= 20K chars → un seul appel LLM


def bmad_extract_referentiel_exhaustif(
    text: str,
    product_number: str,
    document_name: str,
) -> list[dict]:
    """
    Cartographe exhaustif — stratégie adaptative :
    - Doc ≤ 20 000 chars → un seul appel LLM (document entier, contexte préservé)
    - Doc > 20 000 chars → chunking sémantique par section (existant)

    Returns normalised list[dict] compatible with the existing referentiel schema.
    """
    total_chars = len(text)

    # Stratégie single-shot pour les petits documents
    if total_chars <= _SINGLE_SHOT_THRESHOLD:
        logger.info(
            f"[cartographe] '{document_name}': {total_chars} chars ≤ {_SINGLE_SHOT_THRESHOLD} "
            f"→ single-shot (document entier, contexte préservé)"
        )
        chunks = [(1, text)]  # un seul "chunk" = document entier
    else:
        chunks = _split_chunks(text)
        logger.info(
            f"[cartographe] '{document_name}': {total_chars} chars → "
            f"{len(chunks)} chunk(s) de {_CHUNK_SIZE} chars"
        )

    all_raw_items: list[dict] = []

    doc_type = _detect_doc_type(document_name)

    # Build document plan from structural markers (zero-LLM, zero assumptions)
    doc_sections = _extract_document_sections(text)
    if doc_sections:
        doc_plan = (
            "\n═══ PLAN DU DOCUMENT (sections détectées — TOUTES doivent être couvertes) ═══\n"
            + "\n".join(f"  • {s}" for s in doc_sections)
            + "\nPour chaque section listée ci-dessus : extraire TOUS ses éléments fonctionnels.\n"
            "Si une section de ce plan ne produit aucun item dans ton chunk → l'ajouter dans domaines_vides.\n"
        )
        logger.info(f"[cartographe] '{document_name}': {len(doc_sections)} sections détectées → plan injecté")
    else:
        doc_plan = ""
        logger.info(f"[cartographe] '{document_name}': aucune section détectée (pas de marqueurs)")

    # Detect Art.83 context from first chunk to inject domain-specific rules
    first_chunk_text = chunks[0][1] if chunks else ""
    art83_context = _is_art83_context(first_chunk_text if first_chunk_text else text)
    art83_rules = f"\n{_ART83_PB_RULE}\n{_ART83_RACHAT_RULE}\n{_ART83_CHECKLIST}" if art83_context else ""
    if art83_context:
        logger.info(f"[cartographe] '{document_name}': contexte Art.83 détecté — règles spécifiques injectées")

    # Inject NT checklist when document is a Note Technique
    is_note_technique = any(x in document_name.lower() for x in ("note technique", "note_technique", "nt ", "_nt_", "nt_", "actuarielle"))
    nt_rules = f"\n{_NT_CHECKLIST}" if is_note_technique else ""
    if is_note_technique:
        logger.info(f"[cartographe] '{document_name}': Note Technique détectée — checklist NT injectée")

    for chunk_idx, chunk_text in chunks:
        chunk_label = f"Chunk {chunk_idx}/{len(chunks)}"
        prompt = f"""Produit BOSS {product_number} — Document : {document_name} — {chunk_label}
TYPE DE DOCUMENT : {doc_type}

═══ MISSION — CARTOGRAPHIE FONCTIONNELLE EXHAUSTIVE ═══
Tu réalises la cartographie fonctionnelle COMPLÈTE de ce document produit.
L'objectif n'est PAS d'extraire une liste de règles : c'est de capturer L'INTÉGRALITÉ du contenu
fonctionnel — règles, paramètres, calculs, options, conditions, frais, garanties, événements de
gestion, spécificités produit. AUCUNE information métier ne doit être perdue.

Chaque élément extrait sera croisé avec les autres documents du produit (CG, NT, Fiche BOSS,
Avenant) pour détecter les incohérences. La cohérence des rule_name est donc CRITIQUE.

Pour chaque passage, tu dois produire :
▸ items          — règles, paramètres, valeurs chiffrées, conditions, seuils
▸ evenements_gestion — ce qui se passe quand un événement survient (décès, rachat, transfert…)
▸ conditions_acces   — conditions pour accéder à chaque option/garantie
▸ formules       — formules de calcul complètes avec toutes leurs variables
▸ points_a_verifier  — ambiguïtés, contradictions, informations incomplètes

═══ NOMMAGE STANDARDISÉ (OBLIGATOIRE) ═══
{_STANDARD_RULE_NAMES}
→ Si la règle que tu extrais correspond à l'un de ces libellés, utilise-le TEL QUEL comme rule_name.
→ Si elle n'est pas dans la liste, crée un libellé précis et factuel (ex: "Âge plancher liquidation rente").
→ JAMAIS de libellés vagues comme "Règle générale", "Disposition contractuelle", "Paramètre technique".

═══ ÉTAPE 0 — INVENTAIRE PRÉLIMINAIRE (exécuter EN PREMIER) ═══
Avant d'écrire le moindre JSON, lis le passage ENTIER et note mentalement :
▸ Toutes les valeurs numériques, %, montants, taux trouvés dans ce passage
▸ Tous les délais et durées ("30 jours", "avant le 31 décembre", "dans les 8 jours")
▸ Tous les marqueurs de section présents (=== SECTION ===, --- PAGE N ---)
▸ Toutes les formules ou calculs mentionnés
Cet inventaire est ton filet de sécurité : chaque valeur listée DOIT apparaître dans au moins un item.

═══ SIGNAUX LINGUISTIQUES À NE JAMAIS IGNORER ═══
Ces mots introduisent toujours une règle — cherche-les explicitement dans chaque ligne :
"sauf" / "sous réserve" / "à l'exception de"  → clause d'exclusion = règle distincte
"notamment" / "entre autres" / "y compris"    → liste incomplète = documenter chaque élément
"au minimum" / "au plus" / "au moins"         → seuil chiffré = paramètre à extraire
"dans un délai de" / "sous X jours" / "avant le" / "au plus tard" → délai = paramètre chiffré obligatoire
"calcul manuel" / "hors SI" / "hors système"  → contrainte SI → créer entrée 8.24 EN PLUS
"cf." / "voir article" / "conformément à"     → renvoi = lire la cible pour compléter la règle
"prorata" / "au prorata" / "proportionnellement" → formule de calcul à documenter
"tacite reconduction" / "se renouvelle"       → mécanisme de renouvellement = item distinct dans 8.2
"prorogée" / "prorogé" / "peut être reportée" → mécanisme de report = item distinct (date d'effet, délais)
"effet rétroactif" / "rétroactivement"        → date de prise d'effet ≠ date de versement = 2 items
"en vigueur au moment du versement"           → génération de paramètre = item distinct par paramètre
"Il s'agit d'un contrat en élément de rente"  → mécanisme fondamental = extraire dans 8.1 et 8.12

═══ COUVERTURE SYSTÉMATIQUE ═══
1. AVANT d'extraire, liste mentalement tous les articles/sections/paragraphes de ce passage.
2. Pour CHAQUE article/section, extrait TOUTES ses règles atomiques sans exception.
3. Un article introductif sans chiffres = extraire le principe ou l'obligation qu'il établit.
4. Un article avec liste de cas (ex: 6 cas de rachat) = une entrée par cas.
5. Une formule mathématique = une entrée dans "formules" + une synthèse dans "items".
6. JAMAIS sauter un article même s'il te paraît secondaire ou standard.
7. SCAN FINAL OBLIGATOIRE : après avoir traité tous les articles, relire le passage une
   dernière fois et chercher : chiffres, %, montants, délais, conditions, seuils, références
   réglementaires, noms propres d'organismes, qui n'auraient pas encore été capturés.
8. RÈGLE GÉNÉRALE AVANT EXCEPTIONS : avant de lister les cas particuliers, documenter la règle générale.
   Ex: "Épargne indisponible par principe" AVANT les 6 cas de rachat.
   Ex: "Effet du transfert = extinction des droits" AVANT les délais de transfert.
   Ex: Les 3 délais de prescription DISTINCTS (pas seulement un).
9. UNE PHRASE = N ITEMS SI N FAITS : si une phrase contient plusieurs faits distincts (règle 1,
   règle 2, délai, condition), créer un item SÉPARÉ pour chacun.
   ❌ MAUVAIS : rule_name="Date d'effet rente", rule_value="1er jour du trimestre civil après 60 ans,
      prorogeable si SS non liquidée, au plus tard 6 mois après liquidation SS"
   ✓ BON :
     item 1 → rule_name="Date d'effet rente — âge minimum", rule_value="1er jour du trimestre civil qui suit le 60ème anniversaire"
     item 2 → rule_name="Prorogation date d'effet rente — conditions", rule_value="possible tant que l'assuré n'a pas liquidé sa pension SS"
     item 3 → rule_name="Prorogation date d'effet rente — délai maximal", rule_value="au plus tard dans les 6 mois suivant la liquidation SS"

═══ ANTI-BIAIS DE CONNAISSANCE (CRITIQUE) ═══
Tu connais l'assurance-vie standard. Ce document peut contenir des clauses ATYPIQUES
ou SPÉCIFIQUES à ce produit que tu n'as jamais vues.
RÈGLE ABSOLUE : une information inhabituelle, non standard, ou que tu n'as jamais rencontrée
doit être capturée EN PRIORITÉ — c'est précisément pour ça que ce référentiel existe.
Si une clause ne rentre dans aucun domaine 8.1-8.24 → domaine "8.99 Clauses spécifiques produit".
JAMAIS ignorer sous prétexte que "ce n'est pas habituel" ou "hors périmètre standard".

{_DECOMPOSITION_FRAMEWORK}

═══ RÈGLES D'EXTRACTION ═══
- Granularité atomique : une rule = une valeur, une condition, ou une exception.
- source_paragraph = citation EXACTE mot-pour-mot du texte source — OBLIGATOIRE.
  Si tu ne trouves pas la phrase exacte → confidence = 0.1, source_paragraph = "Source non identifiée".
  JAMAIS laisser source_paragraph vide avec une confidence élevée.
- source_page = numéro de page du marqueur --- PAGE N --- le plus proche avant cet extrait.
- Si deux formulations contradictoires dans le même passage → entrée dans "ecarts".
- Formules complètes → entrée dans "formules" avec toutes les variables.
- Si valeur absente dans ce passage : rule_value = "NON TROUVEE DANS CE DOCUMENT".
- Si ambigu : rule_value = "A VERIFIER". Ne jamais inventer.

═══ ANTI-HALLUCINATION (CRITIQUE) ═══
Crée une entrée UNIQUEMENT si l'information est mot-pour-mot dans le passage ci-dessus.
JAMAIS inférer qu'un paramètre "devrait exister" pour ce type de produit.
JAMAIS créer une entrée parce que ce produit ressemble à un produit que tu connais.
Si le document ne parle pas de supports UC → pas d'entrée supports UC.
Si le document ne parle pas de gestion pilotée → pas d'entrée gestion pilotée.
Si le document ne mentionne pas la PPB → pas d'entrée PPB.
Règle : pas de texte source = pas d'entrée.

═══ RÈGLE SI OBLIGATOIRE ═══
Pour toute règle contenant "calcul manuel", "hors SI", "outil alternatif", "non pris en charge",
"outil Excel", ou impliquant une limitation du système de gestion :
→ Créer l'entrée normale dans son domaine (8.x)
→ ET créer EN PLUS une entrée dans 8.24 avec :
   rule_name = "Contrainte SI — [copie du rule_name de la règle]"
   rule_value = description de la contrainte (calcul manuel / outil alternatif / hors SIP...)

═══ VÉRIFICATION FINALE — CHAMPS OBLIGATOIRES (après rédaction du JSON) ═══
Relis ton JSON. Pour chaque domaine 8.1 à 8.24 où tu n'as AUCUN item :
→ Ajoute son nom dans le champ "domaines_vides" de ta réponse.
Exemples : ["8.3 Assurés et souscription", "8.5 Dates de valeur", "8.21 Prescription"]
BUT : permettre au système de détecter les zones potentiellement non cartographiées.

{_CARTOGRAPHE_DOMAINES}
{doc_plan}
{art83_rules}
{nt_rules}
PASSAGE À ANALYSER ({chunk_label}) :
---
{chunk_text}
---

Réponds UNIQUEMENT en JSON valide :
{_CARTOGRAPHE_OUTPUT}"""

        try:
            raw = _agent_call("cartographe", settings.anthropic_model, prompt, max_tokens=8192)
            result = _parse_json(raw)
            chunk_items = _normalise_cartographe_result(result)
            all_raw_items.extend(chunk_items)
            logger.info(
                f"[cartographe] '{document_name}' {chunk_label}: "
                f"{len(result.get('items',[]))} items + "
                f"{len(result.get('ecarts',[]))} écarts + "
                f"{len(result.get('formules',[]))} formules + "
                f"{len(result.get('points_a_verifier',[]))} points_a_verifier"
            )
        except Exception as e:
            logger.error(
                f"[cartographe] '{document_name}' {chunk_label} erreur: "
                f"{type(e).__name__}: {e}"
            )

    # --- Low-yield re-pass: re-prompt sparse chunks for missed numerical/technical values ---
    LOW_YIELD_THRESHOLD = 2
    for chunk_idx, chunk_text in chunks:
        chunk_label = f"Chunk {chunk_idx}/{len(chunks)}"
        # Count items already extracted from this chunk (approximate by source_paragraph overlap)
        chunk_item_count = sum(
            1 for it in all_raw_items
            if it.get("source_paragraph") and chunk_text[:200] in it.get("source_paragraph", "")[:200]
               or (it.get("source_page") and f"--- PAGE {it.get('source_page')}" in chunk_text)
        )
        if chunk_item_count >= LOW_YIELD_THRESHOLD:
            continue
        # This chunk has fewer than LOW_YIELD_THRESHOLD items — re-prompt for missed values
        repass_prompt = f"""Document : {document_name} — Relecture ciblée {chunk_label}

Ce passage n'a produit que {chunk_item_count} règle(s) lors de la première extraction.
Recherche UNIQUEMENT les informations à valeur numérique, délai, ou condition précise qui auraient été manquées.

RÈGLE ABSOLUE : n'extraire que ce qui est mot-pour-mot dans le texte ci-dessous.
Si rien de nouveau → retourner {{"items": []}}

PASSAGE :
---
{chunk_text}
---

Réponds en JSON : {{"items": [{{"domaine":"<8.x>","rule_name":"<nom>","rule_value":"<valeur>","source_paragraph":"<citation exacte>","source_page":<int|null>,"confidence":<float>}}]}}"""
        try:
            raw_repass = _agent_call("cartographe", settings.anthropic_model, repass_prompt, max_tokens=2048)
            result_repass = _parse_json(raw_repass)
            repass_items = _normalise_cartographe_result(result_repass)
            if repass_items:
                all_raw_items.extend(repass_items)
                logger.info(f"[cartographe] '{document_name}' {chunk_label} re-pass: +{len(repass_items)} items supplémentaires")
        except Exception as e_repass:
            logger.debug(f"[cartographe] '{document_name}' {chunk_label} re-pass skipped: {e_repass}")

    if not all_raw_items:
        return []

    # --- Étape 1 : déduplication déterministe Python (doublons exacts de chunks overlap) ---
    before_dedup = len(all_raw_items)
    seen_triples: set[tuple] = set()
    deduped_items: list[dict] = []
    for it in all_raw_items:
        # Clé normalisée : catégorie + nom + valeur (insensible à la casse/accents/espaces)
        import unicodedata as _ud
        def _nk(s: str) -> str:
            nfkd = _ud.normalize("NFKD", s or "")
            no_acc = "".join(c for c in nfkd if not _ud.combining(c))
            return _re.sub(r"\s+", " ", no_acc.lower().strip(" .,;:"))
        triple = (
            _nk(it.get("category", "")),
            _nk(it.get("rule_name", "")),
            _nk(it.get("rule_value", "")),
        )
        if triple not in seen_triples:
            seen_triples.add(triple)
            deduped_items.append(it)
    all_raw_items = deduped_items
    logger.info(
        f"[cartographe] '{document_name}' dédup Python: "
        f"{before_dedup} → {len(all_raw_items)} items "
        f"({before_dedup - len(all_raw_items)} doublons exacts supprimés)"
    )

    # --- Étape 2 : Consolidateur IA pour les quasi-doublons sémantiques ---
    # Traité par batch de 150 pour éviter la limite de tokens
    if len(chunks) > 1 and len(all_raw_items) > 1:
        try:
            BATCH = 150
            final_indices: list[int] = []
            offset = 0
            while offset < len(all_raw_items):
                batch = all_raw_items[offset:offset + BATCH]
                batch_for_ai = [
                    {"idx": offset + i, "rule_name": it["rule_name"],
                     "rule_value": it["rule_value"][:120], "category": it["category"]}
                    for i, it in enumerate(batch)
                ]
                consol_prompt = f"""Tu es le Consolidateur. Voici {len(batch)} items (indices {offset}–{offset+len(batch)-1}) extraits du document '{document_name}'.
Certains peuvent être des quasi-doublons sémantiques (même règle, légèrement reformulée).

Items :
{json.dumps(batch_for_ai, ensure_ascii=False, indent=1)}

RÈGLES :
1. Quasi-doublon CERTAIN (même règle, légère reformulation, même valeur) → garder l'idx le plus petit.
2. Vrai conflit (même règle, valeurs contradictoires) → garder LES DEUX idx.
3. Règles distinctes (rule_name différent = information différente) → GARDER TOUS.
4. Doute → garder.

Retourne les indices GLOBAUX à conserver (utilise le champ "idx" de chaque item).
Réponds UNIQUEMENT en JSON : {{"indices_a_garder": [idx1, idx2, ...]}}"""

                raw_c = _agent_call(
                    "consolidateur", settings.anthropic_model_fast,
                    consol_prompt, max_tokens=2048
                )
                result_c = _parse_json(raw_c)
                batch_indices = result_c.get("indices_a_garder", [])
                if batch_indices and len(batch_indices) >= len(batch) * 0.3:
                    final_indices.extend(batch_indices)
                else:
                    # Consolidateur trop agressif ou erreur → garder tout le batch
                    final_indices.extend(range(offset, offset + len(batch)))
                offset += BATCH

            if final_indices:
                idx_set = set(final_indices)
                consolidated = [it for i, it in enumerate(all_raw_items) if i in idx_set]
                logger.info(
                    f"[cartographe] '{document_name}' consolidation IA: "
                    f"{len(all_raw_items)} → {len(consolidated)} items"
                )
                return consolidated
        except Exception as e:
            logger.warning(f"[cartographe] '{document_name}' consolidation IA failed: {e} — retour items dédup Python")

    logger.info(f"[cartographe] '{document_name}': {len(all_raw_items)} items finaux")
    return all_raw_items




# ---------------------------------------------------------------------------
# Workflow 1 — bmad_extract_referentiel
# ---------------------------------------------------------------------------

def bmad_extract_referentiel(
    text: str,
    product_number: str,
    document_name: str,
) -> list[dict]:
    """
    Primary extraction: Cartographe exhaustif (24 domaines, granularité atomique).
    Fallback: 3-agent pipeline (Actuaire → Juriste → Consolidateur).
    """
    # --- PRIMARY: Cartographe exhaustif ---
    cartographe_items = bmad_extract_referentiel_exhaustif(text, product_number, document_name)
    if cartographe_items:
        logger.info(f"[bmad_extract_referentiel][{document_name}] Cartographe: {len(cartographe_items)} items")
        return cartographe_items

    logger.warning(f"[bmad_extract_referentiel][{document_name}] Cartographe vide — fallback 3-agents")

    # --- FALLBACK: 3-agent pipeline ---
    text_sample = text[:12000]

    # ------------------------------------------------------------------
    # Pass 1 – Actuaire: technical/actuarial fields
    # ------------------------------------------------------------------
    actuaire_prompt = f"""Analyse ce document du produit BOSS {product_number} ({document_name}).

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

    items_pass1: list[dict] = []
    try:
        raw1 = _agent_call("actuaire", settings.anthropic_model, actuaire_prompt, max_tokens=4096)
        result1 = _parse_json(raw1)
        items_pass1 = [it for it in result1.get("items", []) if it.get("rule_value") is not None]
        logger.info(f"[bmad_extract_referentiel][{document_name}] Pass1 Actuaire: {len(items_pass1)} items")
    except Exception as e:
        logger.error(f"[bmad_extract_referentiel][{document_name}] Pass1 Actuaire error: {type(e).__name__}: {e}")

    # ------------------------------------------------------------------
    # Pass 2 – Juriste: administrative/commercial fields
    # ------------------------------------------------------------------
    juriste_prompt = f"""Analyse ce document du produit BOSS {product_number} ({document_name}).

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

    items_pass2: list[dict] = []
    try:
        raw2 = _agent_call("juriste", settings.anthropic_model, juriste_prompt, max_tokens=4096)
        result2 = _parse_json(raw2)
        items_pass2 = [it for it in result2.get("items", []) if it.get("rule_value") is not None]
        logger.info(f"[bmad_extract_referentiel][{document_name}] Pass2 Juriste: {len(items_pass2)} items")
    except Exception as e:
        logger.error(f"[bmad_extract_referentiel][{document_name}] Pass2 Juriste error: {type(e).__name__}: {e}")

    combined = items_pass1 + items_pass2

    # ------------------------------------------------------------------
    # Pass 3 – Consolidateur: deduplicate and flag conflicts
    # ------------------------------------------------------------------
    if not combined:
        logger.info(f"[bmad_extract_referentiel][{document_name}] No items to consolidate")
        return combined

    combined_json = json.dumps(combined, ensure_ascii=False)
    consolidateur_prompt = f"""Consolide ces {len(combined)} items extraits par 2 experts (actuaire + juriste).

Items à consolider :
{combined_json}

INSTRUCTIONS :
- Élimine les doublons (garde le plus précis/complet)
- Marque conflict=true UNIQUEMENT si deux items ont des valeurs contradictoires (pas seulement des reformulations différentes)
- Conserve tous les items pertinents non dupliqués
- Retourne la liste finale consolidée

Réponds UNIQUEMENT en JSON :
{_OUTPUT_FORMAT}"""

    try:
        raw3 = _agent_call("consolidateur", settings.anthropic_model_fast, consolidateur_prompt, max_tokens=2048)
        result3 = _parse_json(raw3)
        consolidated = [it for it in result3.get("items", []) if it.get("rule_value") is not None]
        logger.info(f"[bmad_extract_referentiel][{document_name}] Pass3 Consolidateur: {len(consolidated)} items (from {len(combined)})")
        return consolidated
    except Exception as e:
        logger.error(f"[bmad_extract_referentiel][{document_name}] Pass3 Consolidateur error: {type(e).__name__}: {e}")
        # Fallback: return combined items from passes 1+2
        logger.info(f"[bmad_extract_referentiel][{document_name}] Fallback: returning {len(combined)} combined items")
        return combined


# ---------------------------------------------------------------------------
# Workflow 2 — bmad_pre_mapping
# ---------------------------------------------------------------------------

def bmad_pre_mapping(
    all_fields: list[dict],
    referentiel_items: list[dict],
) -> list[dict]:
    """
    2-agent mapping pipeline.
    Pass 1 (ExpertKELIA)        → build initial mapping table
    Pass 2 (ValidateurMapping)  → validate and correct scores/types
    """
    real_ref = _filter_real_ref(referentiel_items)

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

    # ------------------------------------------------------------------
    # Pass 1 – ExpertKELIA: build initial mapping table
    # ------------------------------------------------------------------
    expert_kelia_prompt = f"""Construis la table de correspondance entre les champs du template KELIA et les règles du référentiel produit.

## RÉFÉRENTIEL PRODUIT ({len(real_ref)} règles) :
{ref_text}

{_SYNONYMES_MAPPING}

## CHAMPS KELIA À MAPPER ({len(all_fields)} champs) :
{fields_text}

## RÈGLES DE MATCHING :
- "exact" (score 95-100) : le libellé du champ KELIA correspond exactement ou presque à la règle référentiel
- "synonyme" (score 80-94) : synonyme métier direct selon la liste ci-dessus
- "hypothese" (score 40-79) : correspondance sémantique approchée — le sens est proche mais le libellé diffère significativement
  → Dans ce cas, la justification DOIT expliquer l'hypothèse faite
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

    mappings_pass1: list[dict] = []
    try:
        raw1 = _agent_call("expert_kelia", settings.anthropic_model, expert_kelia_prompt, max_tokens=4096)
        result1 = _parse_json(raw1)
        mappings_pass1 = result1.get("mappings", [])
        logger.info(f"[bmad_pre_mapping] Pass1 ExpertKELIA: {len(mappings_pass1)} mappings")
    except Exception as e:
        logger.error(f"[bmad_pre_mapping] Pass1 ExpertKELIA error: {type(e).__name__}: {e}")
        return []

    if not mappings_pass1:
        return []

    # ------------------------------------------------------------------
    # Pass 2 – ValidateurMapping: validate and correct scores/types
    # ------------------------------------------------------------------
    mappings_json = json.dumps(mappings_pass1, ensure_ascii=False)
    validateur_prompt = f"""Valide cette table de mapping KELIA construite par un expert.

Mappings à valider :
{mappings_json}

RÈGLES DE VALIDATION :
- Un mapping "hypothese" ne peut JAMAIS avoir score > 79
- Un mapping "exact" doit avoir score >= 95 ; sinon le déclasser en "synonyme" ou "hypothese"
- Un mapping "synonyme" doit avoir score entre 80 et 94
- Vérifie que les justifications sont présentes et pertinentes pour les hypothèses
- Corrige les match_type et scores incohérents
- Sois sceptique : préfère déclasser un mapping que l'élever

Réponds UNIQUEMENT en JSON valide :
{{
  "mappings": [
    {{
      "champ_kelia": "<nom exact du champ KELIA>",
      "champ_ref": "<rule_name exact du référentiel, ou null>",
      "valeur_ref": "<rule_value du référentiel, ou null>",
      "match_type": "exact | synonyme | hypothese | non_trouve",
      "score": <int 0-100>,
      "justification": "<justification corrigée ou null>"
    }}
  ]
}}"""

    try:
        raw2 = _agent_call("validateur_mapping", settings.anthropic_model_fast, validateur_prompt, max_tokens=2048)
        result2 = _parse_json(raw2)
        mappings_pass2 = result2.get("mappings", [])
        logger.info(f"[bmad_pre_mapping] Pass2 ValidateurMapping: {len(mappings_pass2)} mappings validated")
        return mappings_pass2
    except Exception as e:
        logger.error(f"[bmad_pre_mapping] Pass2 ValidateurMapping error: {type(e).__name__}: {e}")
        # Fallback: return Pass 1 results
        logger.info(f"[bmad_pre_mapping] Fallback: returning {len(mappings_pass1)} Pass1 mappings")
        return mappings_pass1


# ---------------------------------------------------------------------------
# Workflow 3 — bmad_fill_fiche_sheet
# ---------------------------------------------------------------------------

def bmad_fill_fiche_sheet(
    sheet_name: str,
    fields: list[dict],
    referentiel_items: list[dict],
    product_number: str,
    cr_items: list[dict] | None = None,
    mapping_table: list[dict] | None = None,
) -> list[dict]:
    """
    2-agent fiche sheet filling pipeline.
    Pass 1 (MOAAssurance)        → fill all fields
    Pass 2 (ControleurCoherence) → flag incoherences on RENSEIGNE items
    """
    real_ref = _filter_real_ref(referentiel_items)

    # Build mapping lookup from mapping_table
    mapping_lookup: dict[str, dict] = {}
    if mapping_table:
        for m in mapping_table:
            key = (m.get("champ_kelia") or "").strip().lower()
            if key:
                mapping_lookup[key] = m

    # Reference summary
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

    # Pre-mapping hints
    mapping_hints = ""
    if mapping_lookup:
        sheet_fields_keys = {f.get("parameter", "").strip().lower() for f in fields}
        relevant = [m for m in (mapping_table or []) if (m.get("champ_kelia", "").strip().lower() in sheet_fields_keys)]
        if relevant:
            hint_lines = []
            for m in relevant:
                mt = m.get("match_type", "")
                if mt == "non_trouve":
                    continue
                justif = f' — HYPOTHÈSE: {m["justification"]}' if mt == "hypothese" and m.get("justification") else ""
                hint_lines.append(
                    f'- "{m["champ_kelia"]}" → référentiel "{m.get("champ_ref","")}" '
                    f'(valeur: "{str(m.get("valeur_ref",""))[:80]}", score: {m.get("score",0)}, type: {mt}){justif}'
                )
            if hint_lines:
                mapping_hints = "\n## PRÉ-MAPPING (correspondances déjà calculées — utiliser en priorité) :\n" + "\n".join(hint_lines) + "\n"

    # CR Atelier
    has_cr = bool(cr_items)
    cr_section = ""
    cr_instructions = ""
    if has_cr:
        cr_lines = []
        for item in (cr_items or []):
            rn = item.get("rule_name", "")
            val = item.get("value", "")
            fname = item.get("filename", "")
            src = item.get("source_paragraph", "")
            cr_lines.append(f'- champ="{rn}" | valeur="{val}" | CR="{fname}" | "{src[:100]}"')
        cr_summary_text = "\n".join(cr_lines)
        cr_section = f"\nCR ATELIER — PRIORITÉ ABSOLUE sur le référentiel :\n{cr_summary_text}\n"
        cr_instructions = """
RÈGLE CR ATELIER :
- Si un item CR correspond : cr_override=true, utiliser SA valeur, cr_rule_matched=nom exact de l'item CR.
- Sinon : cr_override=false, cr_rule_matched=null.
"""

    # Fields list
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

    # ------------------------------------------------------------------
    # Pass 1 – MOAAssurance: fill all fields
    # ------------------------------------------------------------------
    moa_prompt = f"""Produit BOSS : {product_number} — Feuille : {sheet_name}

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

    items_pass1: list[dict] = []
    try:
        raw1 = _agent_call("moa_assurance", settings.anthropic_model, moa_prompt, max_tokens=4096)
        result1 = _parse_json(raw1)
        items_pass1 = result1.get("items", [])
        logger.info(f"[bmad_fill_fiche_sheet][{sheet_name}] Pass1 MOAAssurance: {len(items_pass1)} items")
    except Exception as e:
        logger.error(f"[bmad_fill_fiche_sheet][{sheet_name}] Pass1 MOAAssurance error: {type(e).__name__}: {e}")
        return []

    if not items_pass1:
        return []

    # ------------------------------------------------------------------
    # Pass 2 – ControleurCoherence: flag incoherences on RENSEIGNE items
    # ------------------------------------------------------------------
    renseigne_items = [it for it in items_pass1 if (it.get("statut") or "").upper() == "RENSEIGNE"]

    if renseigne_items:
        renseigne_json = json.dumps(renseigne_items, ensure_ascii=False)
        controleur_prompt = f"""Contrôle la cohérence de ces valeurs renseignées pour la feuille '{sheet_name}' du produit BOSS {product_number}.

Valeurs renseignées :
{renseigne_json}

INSTRUCTIONS :
- Signale UNIQUEMENT les incohérences réelles (valeur impossible, contradiction inter-champs)
- Ne signale PAS les simples absences de valeur
- Exemples d'incohérences réelles :
  * Art.83 déclaré mais Nature du produit ≠ Retraite collective
  * TMG > 3,5% pour un contrat post-2016
  * Frais sur versements > 5% (suspect, à signaler)
  * Branche vie associée à prévoyance pure

Pour chaque incohérence : indique le champ, la valeur problématique, et pourquoi c'est incohérent.

Réponds UNIQUEMENT en JSON :
{{
  "incoherences": [
    {{
      "champ": "<nom exact du champ>",
      "valeur": "<valeur problématique>",
      "probleme": "<explication de l'incohérence>"
    }}
  ]
}}"""

        try:
            raw2 = _agent_call("controleur_coherence", settings.anthropic_model_fast, controleur_prompt, max_tokens=1024)
            result2 = _parse_json(raw2)
            incoherences = result2.get("incoherences", [])
            logger.info(f"[bmad_fill_fiche_sheet][{sheet_name}] Pass2 ControleurCoherence: {len(incoherences)} incoherences")

            # Enrich items with incoherence flags
            inco_by_champ = {ic.get("champ", "").lower(): ic for ic in incoherences}
            for item in items_pass1:
                param_key = (item.get("parameter") or "").lower()
                if param_key in inco_by_champ:
                    ic = inco_by_champ[param_key]
                    item["conflict"] = True
                    existing_comment = item.get("justification") or ""
                    item["justification"] = (
                        existing_comment + f" ⚠ Incohérence signalée: {ic['probleme']}"
                    ).strip()
        except Exception as e:
            logger.error(f"[bmad_fill_fiche_sheet][{sheet_name}] Pass2 ControleurCoherence error: {type(e).__name__}: {e}")
            # Fallback: continue with Pass 1 results as-is

    # ------------------------------------------------------------------
    # Normalise output to internal format expected by fiche_service
    # ------------------------------------------------------------------
    normalised = []
    for it in items_pass1:
        statut = (it.get("statut") or "NON_TROUVE").upper()
        valeur = it.get("valeur_retenue") if statut == "RENSEIGNE" and it.get("valeur_retenue") else None
        normalised.append({
            "parameter":              it.get("parameter"),
            "value":                  valeur or NO_VALUE,
            "rule_name_ref":          it.get("champ_source"),
            "source_citation":        it.get("valeur_source"),
            "source_paragraph":       f"Règle référentiel: {it['champ_source']}" if it.get("champ_source") else None,
            "confidence":             (it.get("score_confiance") or 0) / 100.0,
            "conflict":               bool(it.get("conflict", False)),
            "cr_override":            bool(it.get("cr_override", False)),
            "cr_rule_matched":        it.get("cr_rule_matched"),
            "value_from_referentiel": it.get("value_from_referentiel"),
            "comment":                it.get("justification"),
        })
    return normalised


# ---------------------------------------------------------------------------
# Workflow 4 — bmad_compare_parametrage
# ---------------------------------------------------------------------------

def bmad_compare_parametrage(
    target_items: list[dict],
    delivered_items: list[dict],
) -> list[dict]:
    """
    3-agent comparison pipeline.
    Pass 1 (ExpertFonctionnel) → functional compliance analysis
    Pass 2 (ExpertTechnique)   → technical root-cause for Écart/Manquant
    Pass 3 (AuditeurEcarts)    → adversarial final audit and prioritisation
    """
    target_json = json.dumps(target_items[:40], ensure_ascii=False, indent=2)
    delivered_json = json.dumps(delivered_items[:40], ensure_ascii=False, indent=2)

    # ------------------------------------------------------------------
    # Pass 1 – ExpertFonctionnel: functional compliance analysis
    # ------------------------------------------------------------------
    fonctionnel_prompt = f"""Analyse fonctionnellement la conformité du paramétrage livré versus le paramétrage attendu.

Paramétrage cible attendu :
{target_json}

Paramétrage livré :
{delivered_json}

Pour chaque règle, détermine le statut fonctionnel :
- Conforme : valeur livrée correspond fonctionnellement à la cible
- Écart : valeur livrée diffère de la cible
- Manquant : règle cible absente du livré
- Supplémentaire : règle livrée absente de la cible
Parle en termes métier. Explique l'impact fonctionnel de chaque écart.

Réponds UNIQUEMENT en JSON :
{{
  "details": [
    {{
      "module": "<module fonctionnel>",
      "rule_name": "<nom de la règle>",
      "expected_value": "<valeur attendue>",
      "obtained_value": "<valeur obtenue>",
      "status": "Conforme | Écart | Manquant | Supplémentaire",
      "criticite": "Critique | Majeure | Mineure",
      "justification": "<explication fonctionnelle>",
      "ai_comment": "<commentaire additionnel>"
    }}
  ]
}}"""

    details_pass1: list[dict] = []
    try:
        raw1 = _agent_call("expert_fonctionnel", settings.anthropic_model, fonctionnel_prompt, max_tokens=2000)
        result1 = _parse_json(raw1)
        details_pass1 = result1.get("details", [])
        logger.info(f"[bmad_compare_parametrage] Pass1 ExpertFonctionnel: {len(details_pass1)} items")
    except Exception as e:
        logger.error(f"[bmad_compare_parametrage] Pass1 ExpertFonctionnel error: {type(e).__name__}: {e}")
        return []

    if not details_pass1:
        return []

    # ------------------------------------------------------------------
    # Pass 2 – ExpertTechnique: technical root-cause for Écart/Manquant
    # ------------------------------------------------------------------
    ecarts = [d for d in details_pass1 if d.get("status") in ("Écart", "Manquant")]
    analyses_by_rule: dict[str, dict] = {}

    if ecarts:
        ecarts_json = json.dumps(ecarts, ensure_ascii=False, indent=2)
        technique_prompt = f"""Analyse techniquement ces écarts identifiés lors de la revue fonctionnelle.

Écarts à analyser :
{ecarts_json}

Pour chaque écart :
- Identifie le module KELIA/SIP concerné précisément
- Détermine la cause technique probable
- Précise si l'écart est imputable à KAPIA (paramétrage produit) ou à SIP (configuration système)

Réponds UNIQUEMENT en JSON :
{{
  "analyses": [
    {{
      "rule_name": "<nom exact de la règle>",
      "module_technique": "<module KELIA/SIP précis>",
      "cause_probable": "<cause technique probable>",
      "imputable_a": "KAPIA | SIP | Les deux | Indéterminé"
    }}
  ]
}}"""

        try:
            raw2 = _agent_call("expert_technique", settings.anthropic_model_fast, technique_prompt, max_tokens=1500)
            result2 = _parse_json(raw2)
            analyses = result2.get("analyses", [])
            analyses_by_rule = {a.get("rule_name", ""): a for a in analyses}
            logger.info(f"[bmad_compare_parametrage] Pass2 ExpertTechnique: {len(analyses)} analyses")
        except Exception as e:
            logger.error(f"[bmad_compare_parametrage] Pass2 ExpertTechnique error: {type(e).__name__}: {e}")

    # ------------------------------------------------------------------
    # Pass 3 – AuditeurEcarts: adversarial final audit and prioritisation
    # ------------------------------------------------------------------
    combined_context = {
        "details_fonctionnels": details_pass1,
        "analyses_techniques": list(analyses_by_rule.values()),
    }
    combined_json = json.dumps(combined_context, ensure_ascii=False, indent=2)

    ecarts_supplementaires: list[dict] = []
    priorites_by_rule: dict[str, dict] = {}

    auditeur_prompt = f"""Audit adversarial final du paramétrage KELIA livré.

Contexte des analyses précédentes (fonctionnel + technique) :
{combined_json}

MISSION :
1. Cherche activement les écarts non identifiés par les passes précédentes
2. Priorise TOUS les écarts identifiés (passes précédentes + nouveaux) par criticité finale
3. Propose des corrections précises et actionnables

Réponds UNIQUEMENT en JSON :
{{
  "ecarts_supplementaires": [
    {{
      "module": "<module>",
      "rule_name": "<règle>",
      "expected_value": "<valeur attendue>",
      "obtained_value": "<valeur obtenue>",
      "status": "Écart | Manquant | Supplémentaire",
      "criticite": "Critique | Majeure | Mineure",
      "justification": "<justification>",
      "ai_comment": "<commentaire>"
    }}
  ],
  "priorites": [
    {{
      "rule_name": "<nom exact de la règle>",
      "criticite_finale": "Critique | Majeure | Mineure",
      "correction_proposee": "<correction précise et actionnable>"
    }}
  ]
}}"""

    try:
        raw3 = _agent_call("auditeur_ecarts", settings.anthropic_model_fast, auditeur_prompt, max_tokens=1500)
        result3 = _parse_json(raw3)
        ecarts_supplementaires = result3.get("ecarts_supplementaires", [])
        priorites = result3.get("priorites", [])
        priorites_by_rule = {p.get("rule_name", ""): p for p in priorites}
        logger.info(
            f"[bmad_compare_parametrage] Pass3 AuditeurEcarts: "
            f"{len(ecarts_supplementaires)} écarts supplémentaires, {len(priorites)} priorités"
        )
    except Exception as e:
        logger.error(f"[bmad_compare_parametrage] Pass3 AuditeurEcarts error: {type(e).__name__}: {e}")

    # ------------------------------------------------------------------
    # Merge all 3 passes into final list
    # ------------------------------------------------------------------
    final_items = list(details_pass1)

    # Enrich Pass 1 items with technical analysis from Pass 2
    for item in final_items:
        rule_name = item.get("rule_name", "")
        if rule_name in analyses_by_rule:
            tech = analyses_by_rule[rule_name]
            existing_comment = item.get("ai_comment") or ""
            item["ai_comment"] = (
                existing_comment +
                f" [Technique: {tech.get('module_technique','')} — {tech.get('cause_probable','')} — Imputable: {tech.get('imputable_a','')}]"
            ).strip()

    # Apply final priorities from Pass 3
    for item in final_items:
        rule_name = item.get("rule_name", "")
        if rule_name in priorites_by_rule:
            prio = priorites_by_rule[rule_name]
            item["criticite"] = prio.get("criticite_finale", item.get("criticite"))
            correction = prio.get("correction_proposee")
            if correction:
                existing_comment = item.get("ai_comment") or ""
                item["ai_comment"] = (existing_comment + f" [Correction: {correction}]").strip()

    # Add supplementary gaps from Pass 3
    final_items.extend(ecarts_supplementaires)

    logger.info(f"[bmad_compare_parametrage] Final: {len(final_items)} items total")
    return final_items
