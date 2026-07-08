# KELIA Migration IA — Application de Migration de Produits d'Assurance

## Prérequis

- Python 3.11+
- Node.js 18+
- Une clé API Anthropic (Claude)

## Configuration

1. Copier `.env.example` vers `.env`
2. Renseigner votre clé Anthropic : `ANTHROPIC_API_KEY=sk-ant-...`

## Démarrage

### Option A — Scripts Windows
```
start_backend.bat    # Terminal 1
start_frontend.bat   # Terminal 2
```

### Option B — Manuellement
```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (autre terminal)
cd frontend
npm install
npm run dev
```

### Accès
- Application : http://localhost:3000
- API docs : http://localhost:8000/api/docs

## Architecture

```
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI app
│   │   ├── config.py         # Configuration
│   │   ├── database.py       # SQLAlchemy / SQLite
│   │   ├── models/           # Modèles de données
│   │   ├── api/              # Routes API
│   │   ├── services/         # Logique métier + IA
│   │   └── utils/            # Extraction texte
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── app/              # Pages Next.js
│       ├── components/       # Composants React
│       └── lib/              # API client, types
└── storage/
    ├── documents/            # Fichiers uploadés
    │   ├── generique/
    │   └── produits/
    └── exports/              # Exports Excel générés
```

## Étapes implémentées

| Étape | Module | Statut |
|-------|--------|--------|
| 0 | Ingestion & classification documentaire | Complet |
| 1 | Référentiel Produit (extraction IA) | Complet |
| 2 | Fiche Produit KELIA | En cours |
| 3 | Paramétrage Cible KELIA | En cours |
| 4 | Ateliers & Arbitrages | En cours |
| 5-6 | Contrôles & Régressions | En cours |
| 7 | Recette & Anomalies | En cours |
| 8 | Reporting Portefeuille | Complet |
| 9 | Versioning | En cours |
