# -*- coding: utf-8 -*-
"""Génère le schéma flux applicatif KELIA — style Accenture."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

# ── Palette Accenture ────────────────────────────────────────────────────────
AC_PURPLE   = "#A100FF"   # violet signature Accenture
AC_DARK     = "#1A0035"   # fond sombre violet-noir
AC_MID      = "#3D006E"   # violet intermédiaire
AC_LIGHT    = "#E5CCFF"   # violet très clair (texte sur fond sombre)
AC_GRAY     = "#F2F2F2"   # gris clair
AC_DGRAY    = "#4A4A4A"   # gris texte
AC_WHITE    = "#FFFFFF"
AC_BLACK    = "#000000"

# Couleurs fonctionnelles
C_DOCS      = "#6200A3"   # violet profond — documents
C_IA        = "#A100FF"   # violet vif — IA
C_FPP       = "#00C0A0"   # teal — FPP générée
C_CONF      = "#FF6B2B"   # orange — conformité
C_RECETTE   = "#0070C0"   # bleu — recette
C_NONREG    = "#7030A0"   # violet sombre — non-régression
C_ARROW     = "#A100FF"

fig, ax = plt.subplots(figsize=(20, 11))
fig.patch.set_facecolor(AC_DARK)
ax.set_facecolor(AC_DARK)
ax.set_xlim(0, 20)
ax.set_ylim(0, 11)
ax.axis("off")

# ── Helpers ──────────────────────────────────────────────────────────────────
def rbox(ax, x, y, w, h, color, alpha=1.0, radius=0.3, lw=0, edgecolor=None):
    box = FancyBboxPatch(
        (x, y), w, h,
        boxstyle=f"round,pad=0,rounding_size={radius}",
        facecolor=color, alpha=alpha,
        linewidth=lw, edgecolor=edgecolor or color,
        zorder=2
    )
    ax.add_patch(box)
    return box

def txt(ax, x, y, s, size=10, color=AC_WHITE, bold=False, ha="center", va="center", zorder=5):
    weight = "bold" if bold else "normal"
    ax.text(x, y, s, fontsize=size, color=color, fontweight=weight,
            ha=ha, va=va, zorder=zorder, wrap=False)

def arrow(ax, x1, y1, x2, y2, color=C_ARROW, lw=2.5):
    ax.annotate("",
        xy=(x2, y2), xytext=(x1, y1),
        arrowprops=dict(
            arrowstyle="-|>",
            color=color,
            lw=lw,
            mutation_scale=18,
        ),
        zorder=4
    )

def divider(ax, x, y, w, color=AC_PURPLE, lw=1):
    ax.plot([x, x + w], [y, y], color=color, lw=lw, zorder=3)

# ── Titre + bandeau Accenture ────────────────────────────────────────────────
rbox(ax, 0, 10.2, 20, 0.8, AC_PURPLE, radius=0)
txt(ax, 10, 10.6, "Application IA de Migration Produit KELIA  —  Flux Documentaire & Fonctionnel",
    size=15, bold=True, color=AC_WHITE)
# Logo ">" Accenture
txt(ax, 19.3, 10.6, ">", size=22, bold=True, color=AC_WHITE)

# ── COLONNE 1 — Documents sources ────────────────────────────────────────────
rbox(ax, 0.4, 1.0, 3.0, 8.6, C_DOCS, radius=0.25, lw=1.5, edgecolor="#9B30FF")

# Header
rbox(ax, 0.4, 8.7, 3.0, 0.9, "#6200A3", radius=0.2)
txt(ax, 1.9, 9.15, "DOCUMENTS SOURCES", size=10, bold=True, color=AC_WHITE)
txt(ax, 1.9, 8.82, "Entrée — par produit", size=8, color=AC_LIGHT)

docs = [
    ("CG", "Conditions Générales"),
    ("NT", "Note Technique Actuarielle"),
    ("NO", "Notice d'information"),
    ("AV", "Avenant"),
    ("BO", "Extraction BOSS"),
    ("CR", "CR Atelier / Décisions"),
    ("FP", "Fiche Produit existante"),
]
y_doc = 7.9
for code, label in docs:
    rbox(ax, 0.6, y_doc, 2.6, 0.55, "#3D006E", radius=0.15, lw=1, edgecolor="#9B30FF")
    rbox(ax, 0.65, y_doc + 0.05, 0.55, 0.45, AC_PURPLE, radius=0.1)
    txt(ax, 0.925, y_doc + 0.28, code, size=7, bold=True, color=AC_WHITE)
    txt(ax, 2.0, y_doc + 0.28, label, size=8.5, color=AC_LIGHT, ha="center")
    y_doc -= 0.65

# ── COLONNE 2 — Traitement IA ─────────────────────────────────────────────────
rbox(ax, 4.1, 1.0, 4.2, 8.6, "#1D0040", radius=0.25, lw=1.5, edgecolor=AC_PURPLE)

rbox(ax, 4.1, 8.7, 4.2, 0.9, AC_PURPLE, radius=0.2)
txt(ax, 6.2, 9.15, "TRAITEMENT PAR L'IA", size=10, bold=True, color=AC_WHITE)
txt(ax, 6.2, 8.82, "Agents spécialisés — Claude", size=8, color=AC_LIGHT)

etapes = [
    ("01", "Classification automatique",
     "L'IA identifie et classe chaque\ndocument (type, résumé, confiance).\nExtraction texte page par page.",
     "#330066"),
    ("02", "Génération FPP — 4 onglets en parallèle",
     "Produit Technique · Tarif de Rente\nGaranties & Prestations · Mode Gestion\nActuaire + MOA + Expert KELIA.",
     "#4B0082"),
    ("03", "Paramètres orphelins détectés",
     "Frais non listés, codes SI,\nseuils réglementaires, contraintes\nhors template FPP.",
     "#330066"),
]

y_et = 7.8
for num, titre, desc, bg in etapes:
    rbox(ax, 4.3, y_et, 3.8, 2.0, bg, radius=0.2, lw=1, edgecolor=AC_PURPLE)
    # Numéro
    rbox(ax, 4.35, y_et + 1.45, 0.55, 0.45, AC_PURPLE, radius=0.1)
    txt(ax, 4.625, y_et + 1.68, num, size=8, bold=True, color=AC_WHITE)
    # Titre
    txt(ax, 5.2, y_et + 1.68, titre, size=9, bold=True, color=AC_WHITE, ha="left")
    divider(ax, 4.35, y_et + 1.38, 3.65, color="#9B30FF", lw=0.8)
    # Description
    for i, line in enumerate(desc.split("\n")):
        txt(ax, 4.45, y_et + 1.05 - i * 0.28, line, size=8, color=AC_LIGHT, ha="left")
    y_et -= 2.2

# ── COLONNE 3 — FPP Générée ───────────────────────────────────────────────────
rbox(ax, 9.1, 4.5, 2.8, 5.1, "#003D35", radius=0.25, lw=1.5, edgecolor=C_FPP)

rbox(ax, 9.1, 8.7, 2.8, 0.9, C_FPP, radius=0.2)
txt(ax, 10.5, 9.15, "LIVRABLE GÉNÉRÉ", size=10, bold=True, color=AC_BLACK)
txt(ax, 10.5, 8.82, "Sortie principale", size=8, color=AC_BLACK)

rbox(ax, 9.3, 7.4, 2.4, 1.1, "#005040", radius=0.2, lw=1, edgecolor=C_FPP)
txt(ax, 10.5, 8.1, "FPP KELIA", size=11, bold=True, color=C_FPP)
txt(ax, 10.5, 7.78, "Fiche Produit Paramétrage", size=8.5, color=AC_LIGHT)
txt(ax, 10.5, 7.55, ".xlsx — Template KELIA rempli", size=8, color=AC_LIGHT)

# Champs de la FPP
fpp_fields = [
    "Valeur  ·  Score confiance %",
    "Justification (1 phrase)",
    "Citation source exacte",
    "Numéro de page",
    "Contradictions signalées",
]
y_ff = 7.0
for f in fpp_fields:
    txt(ax, 9.4, y_ff, "›", size=10, color=C_FPP, ha="left")
    txt(ax, 9.7, y_ff, f, size=8, color=AC_LIGHT, ha="left")
    y_ff -= 0.38

# Versions
rbox(ax, 9.3, 4.65, 2.4, 0.65, "#005040", radius=0.15, lw=1, edgecolor=C_FPP)
txt(ax, 10.5, 4.98, "Versionnable  V1  V2  V3 ...", size=8, color=C_FPP)

# ── COLONNE 4 — Contrôles ─────────────────────────────────────────────────────
# Conformité
rbox(ax, 12.7, 7.2, 3.4, 2.4, "#3D1400", radius=0.25, lw=1.5, edgecolor=C_CONF)
rbox(ax, 12.7, 8.9, 3.4, 0.7, C_CONF, radius=0.2)
txt(ax, 14.4, 9.28, "CONFORMITE CONTRACTUELLE", size=9, bold=True, color=AC_WHITE)
txt(ax, 14.4, 8.98, "Vérification IA", size=7.5, color=AC_LIGHT)

txt(ax, 12.9, 8.5, "FPP KELIA générée", size=8.5, color=AC_WHITE, ha="left")
txt(ax, 14.4, 8.2, "↕", size=14, bold=True, color=C_CONF)
txt(ax, 12.9, 7.9, "CG ou Notice (PDF)", size=8.5, color=AC_WHITE, ha="left")
divider(ax, 12.85, 7.68, 3.1, color=C_CONF, lw=0.8)
txt(ax, 12.9, 7.48, "conforme · écart · non paramétré", size=7.5, color=AC_LIGHT, ha="left")
txt(ax, 12.9, 7.27, "Score 0-100 + criticité H/M/F", size=7.5, color=AC_LIGHT, ha="left")

# Recette
rbox(ax, 12.7, 4.2, 3.4, 2.6, "#001A3D", radius=0.25, lw=1.5, edgecolor=C_RECETTE)
rbox(ax, 12.7, 6.1, 3.4, 0.7, C_RECETTE, radius=0.2)
txt(ax, 14.4, 6.48, "RECETTE PARAMETRAGE", size=9, bold=True, color=AC_WHITE)
txt(ax, 14.4, 6.18, "Comparaison bi-directionnelle", size=7.5, color=AC_LIGHT)

txt(ax, 12.9, 5.8, "FPP KELIA (référence)", size=8.5, color=AC_WHITE, ha="left")
txt(ax, 14.4, 5.52, "↕", size=14, bold=True, color=C_RECETTE)
txt(ax, 12.9, 5.22, "Paramétrage KELIA livré", size=8.5, color=AC_WHITE, ha="left")
divider(ax, 12.85, 4.98, 3.1, color=C_RECETTE, lw=0.8)
txt(ax, 12.9, 4.76, "Matching fuzzy — sans accents", size=7.5, color=AC_LIGHT, ha="left")
txt(ax, 12.9, 4.52, "Rapport d'écarts Excel", size=7.5, color=AC_LIGHT, ha="left")
txt(ax, 12.9, 4.28, "stable · modifié · absent", size=7.5, color=AC_LIGHT, ha="left")

# Non-régression
rbox(ax, 12.7, 1.2, 3.4, 2.6, "#1A0035", radius=0.25, lw=1.5, edgecolor=C_NONREG)
rbox(ax, 12.7, 3.1, 3.4, 0.7, C_NONREG, radius=0.2)
txt(ax, 14.4, 3.48, "NON-REGRESSION", size=9, bold=True, color=AC_WHITE)
txt(ax, 14.4, 3.18, "Surveillance des évolutions", size=7.5, color=AC_LIGHT)

txt(ax, 12.9, 2.8, "Paramétrage KELIA V1", size=8.5, color=AC_WHITE, ha="left")
txt(ax, 14.4, 2.52, "↕", size=14, bold=True, color=C_NONREG)
txt(ax, 12.9, 2.22, "Paramétrage KELIA V2", size=8.5, color=AC_WHITE, ha="left")
divider(ax, 12.85, 1.98, 3.1, color=C_NONREG, lw=0.8)
txt(ax, 12.9, 1.76, "Diff champ par champ", size=7.5, color=AC_LIGHT, ha="left")
txt(ax, 12.9, 1.52, "stable · modifié · ajouté · supprimé", size=7.5, color=AC_LIGHT, ha="left")
txt(ax, 12.9, 1.28, "Analyse LLM impact métier", size=7.5, color=AC_LIGHT, ha="left")

# ── COLONNE 5 — Outputs ───────────────────────────────────────────────────────
rbox(ax, 17.0, 1.0, 2.6, 8.6, "#0A0015", radius=0.25, lw=1.5, edgecolor="#4A0080")
rbox(ax, 17.0, 8.7, 2.6, 0.9, "#4A0080", radius=0.2)
txt(ax, 18.3, 9.15, "LIVRABLES", size=10, bold=True, color=AC_WHITE)
txt(ax, 18.3, 8.82, "Exports Excel", size=8, color=AC_LIGHT)

outputs = [
    (C_FPP,     "FPP KELIA .xlsx\nremplie & versionnée"),
    (C_CONF,    "Rapport conformité\nScore + écarts"),
    (C_RECETTE, "Rapport recette\nBi-directionnel"),
    (C_NONREG,  "Rapport non-régression\nDiff V1 / V2"),
]
y_out = 7.7
for color, label in outputs:
    rbox(ax, 17.1, y_out, 2.4, 1.1, "#110025", radius=0.2, lw=1.5, edgecolor=color)
    rbox(ax, 17.12, y_out + 0.75, 2.36, 0.3, color, radius=0.1, alpha=0.6)
    for i, line in enumerate(label.split("\n")):
        txt(ax, 18.3, y_out + 0.55 - i * 0.32, line,
            size=8 if i == 0 else 7.5,
            bold=(i == 0),
            color=AC_WHITE if i == 0 else AC_LIGHT)
    y_out -= 1.4

# ── FLÈCHES ───────────────────────────────────────────────────────────────────
# Docs → IA
arrow(ax, 3.42, 5.3, 4.08, 5.3, color=AC_PURPLE, lw=2.5)

# IA → FPP
arrow(ax, 8.32, 6.8, 9.08, 6.8, color=C_FPP, lw=2.5)

# FPP → Conformité
arrow(ax, 11.92, 8.2, 12.68, 8.6, color=C_CONF, lw=2)
# FPP → Recette
arrow(ax, 11.92, 6.5, 12.68, 5.5, color=C_RECETTE, lw=2)
# FPP → Non-régression
arrow(ax, 11.92, 5.0, 12.68, 2.5, color=C_NONREG, lw=2)

# Contrôles → Outputs
arrow(ax, 16.12, 8.4, 16.98, 8.1, color=C_CONF, lw=1.8)
arrow(ax, 16.12, 5.4, 16.98, 6.7, color=C_RECETTE, lw=1.8)
arrow(ax, 16.12, 2.5, 16.98, 5.3, color=C_NONREG, lw=1.8)

# FPP → Outputs (direct)
arrow(ax, 11.92, 7.1, 16.98, 7.9, color=C_FPP, lw=1.8)

# ── Labels flux ───────────────────────────────────────────────────────────────
txt(ax, 3.75, 5.55, "Upload", size=7, color="#C080FF")
txt(ax, 8.70, 7.05, "Génère", size=7, color=C_FPP)

# ── Footer Accenture ──────────────────────────────────────────────────────────
rbox(ax, 0, 0, 20, 0.95, "#0A0015", radius=0)
ax.plot([0, 20], [0.95, 0.95], color=AC_PURPLE, lw=1, zorder=4)
txt(ax, 0.4, 0.48, "Accenture — Usage Confidentiel Client", size=8, color="#9B30FF", ha="left")
txt(ax, 10.0, 0.48, "Application IA Migration KELIA  ·  Architecture Flux Documentaire", size=8, color=AC_LIGHT)
txt(ax, 19.3, 0.48, ">", size=14, bold=True, color=AC_PURPLE)

# ── Sauvegarde ────────────────────────────────────────────────────────────────
out = r"C:\Users\walid.ben.lamine\OneDrive - Accenture\01ApplicactionCartoProduit\schema_kelia_accenture.png"
plt.tight_layout(pad=0)
plt.savefig(out, dpi=180, bbox_inches="tight", facecolor=AC_DARK)
plt.close()
print(f"OK: {out}")
