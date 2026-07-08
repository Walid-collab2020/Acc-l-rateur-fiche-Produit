"""
kelia_constants.py
Shared constants for the KELIA migration AI pipeline.
Both ai_service.py and bmad_agents.py import from here to avoid circular imports.
"""

NO_VALUE = "Aucune règle mentionnée dans les documents analysés"

_EXTRACTION_RULES = f"""RÈGLES D'EXTRACTION :
- Valeur clairement mentionnée dans le document → rule_value = valeur exacte du texte
- Sujet évoqué sans valeur précise → rule_value = "{NO_VALUE}"
- Sujet non mentionné du tout → NE PAS inclure cet item
- Jamais de "Non spécifié", "N/A", "à compléter" ou valeurs inventées
- source_paragraph = extrait exact du texte source (quelques mots suffisent), null si non trouvé"""

_OUTPUT_FORMAT = """{
  "items": [
    {
      "category": "<catégorie>",
      "rule_name": "<nom exact du champ>",
      "rule_value": "<valeur extraite ou sentinel>",
      "rule_unit": "<unité ou null>",
      "source_paragraph": "<extrait exact ou null>",
      "confidence": <float 0.0-1.0>,
      "comment": "<commentaire ou null>"
    }
  ]
}"""

_SYNONYMES_MAPPING = """
SYNONYMES MÉTIER AUTORISÉS (matching sémantique) :
- Assureur / Compagnie d'assurance / Organisme assureur / Porteur de risque → Compagnie / Assureur KELIA
- Produit / Nom du produit / Nom commercial / Libellé produit → Libellé Produit Technique / Nom produit KELIA
- Numéro produit BOSS / Code produit / Identifiant produit → Code Produit Technique / Code produit
- Conditions Générales / CG / Référence CG / N° des Conditions Générales → Référence documentation contractuelle / Référence CG
- Fiscalité / Cadre fiscal / Régime fiscal / Article 83 → Fiscalité produit / Régime fiscal
- Frais sur versements — cotisations obligatoires / Frais sur versements — volontaires libres / Frais sur versements — CET / Frais sur versements — socle facultatif / Frais d'acquisition / Frais d'entrée / Frais sur versement → Frais sur versement (acquisition) %
- Frais de gestion sur encours (taux) / Frais de gestion annuel / Chargement sur encours / Frais sur encours → Frais sur encours (gestion) %
- Frais de transfert individuel / Frais de transfert / Pas de frais de transfert / Frais transfert → Frais sur transfert entrant % / Frais sur transfert sortant %
- Frais sur arrérages rentes en service / Frais de gestion rentes / Frais arrérages → Frais sur arrérages rentes %
- Taxe sur cotisations / Taxe sur versements / TCA / Taxe conventions d'assurance → Taxe sur conventions d'assurance (TCA)
- TMG / Taux minimum garanti / Taux garanti / Taux technique → Taux minimum garanti / TMG
- PB / Participation aux bénéfices / Taux de participation → Participation aux bénéfices / Taux de PB
- Date de valeur / Date d'effet opération → Date de valeur
- Rachat / Retrait / Rachat partiel / Rachat total → Acte de rachat / Rachats
- Arbitrage / Transfert entre supports → Acte d'arbitrage
- Support euro / Fonds euros / Actif général → Support euro
- Garantie décès / Garantie plancher / Capital décès → Garantie décès
- Nature juridique / Type de compagnie → Nature juridique
- Branche d'assurance / Branche vie → Branche
- Objet du contrat / Description produit → Objet / Description
- Affiliation / Adhésion → Modalités d'affiliation
- Sortie principale / Mode de sortie → Sortie / Mode de sortie
- Taux technique / Taux d'intérêt escompté / Taux de capitalisation → Taux technique / IT
- Table de mortalité / Table biométrique / TV / TPRV → Table de mortalité
- Rente viagère / Annuité / Rente → Type de rente / Rente
- Siège social / Adresse assureur → Adresse / Siège
- Statut de commercialisation / Statut produit → Statut commercial
- Type de contrat / Nature du contrat / Famille contrat / Régime retraite / Objet du contrat → Nature du produit / Famille produit / Type produit
- Article 83 / Retraite supplémentaire / PERP / PERCO / IFC → Fiscalité produit / Régime fiscal / Nature du produit

CORRESPONDANCES NOMENCLATURE KELIA pour "Nature du produit" :
- "contrat collectif d'assurance retraite supplémentaire" / "Article 83" / "retraite supplémentaire" → Nature du produit = Retraite collective
- "assurance-vie" / "contrat d'assurance vie" / "assurance vie collective" → Nature du produit = Assurance vie
- "capitalisation" / "contrat de capitalisation" / "géré par capitalisation" → Nature du produit = Capitalisation
- "prévoyance" / "garantie décès" / "incapacité" / "invalidité" → Nature du produit = Prévoyance
"""

_SCORE_RULES = """
SCORE DE CONFIANCE :
- 100 : correspondance exacte du libellé champ ↔ règle référentiel
- 90  : synonyme métier direct (liste ci-dessus)
- 75  : correspondance forte, libellé différent mais sens identique
- 60  : correspondance possible
- <60 : correspondance faible mais existante

Règle : renseigner TOUJOURS si une valeur candidate existe dans le référentiel, quel que soit le score.
Le score sert uniquement à indiquer la confiance — c'est l'utilisateur qui filtre.
Seul cas de statut NON_TROUVE : aucune valeur candidate trouvée dans le référentiel.
"""
