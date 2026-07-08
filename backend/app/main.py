from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.config import settings
from app.database import init_db
from app.api import documents, products, referentiel, reporting, sync, chat, fiches, fiche_direct, recette, non_regression, conformite

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Application IA de Génération, Paramétrage et Recette Produit KELIA",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router, prefix="/api")
app.include_router(products.router, prefix="/api")
app.include_router(referentiel.router, prefix="/api")
app.include_router(reporting.router, prefix="/api")
app.include_router(sync.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(fiches.router, prefix="/api")
app.include_router(fiche_direct.router, prefix="/api")
app.include_router(recette.router, prefix="/api")
app.include_router(non_regression.router, prefix="/api")
app.include_router(conformite.router, prefix="/api")


@app.on_event("startup")
def startup():
    init_db()
    # Ensure storage directories exist
    for d in [settings.documents_dir, settings.exports_dir]:
        Path(d).mkdir(parents=True, exist_ok=True)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": settings.app_version}
