"""
Migration : création de la table fiche_direct_items (Fiche Produit 2).
Exécuter une seule fois : python migrate_fiche_direct.py
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))

from app.database import engine
from app.models.fiche_direct import FicheDirectItem

if __name__ == "__main__":
    FicheDirectItem.__table__.create(engine, checkfirst=True)
    print("OK Table 'fiche_direct_items' creee (ou deja existante).")
