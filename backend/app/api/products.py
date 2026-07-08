from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel

from app.database import get_db
from app.models.product import Product, ProductStatus
from app.models.document import Document

router = APIRouter(prefix="/products", tags=["Products"])


class ProductCreate(BaseModel):
    boss_number: str
    name: Optional[str] = None
    description: Optional[str] = None


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status_referentiel: Optional[str] = None
    status_fiche: Optional[str] = None
    status_parametrage: Optional[str] = None
    status_recette: Optional[str] = None


class ProductResponse(BaseModel):
    id: int
    boss_number: str
    name: Optional[str]
    description: Optional[str]
    status_referentiel: str
    status_fiche: str
    status_parametrage: str
    status_recette: str
    document_count: int
    created_at: str

    class Config:
        from_attributes = True


@router.post("/", response_model=ProductResponse)
def create_product(body: ProductCreate, db: Session = Depends(get_db)):
    existing = db.query(Product).filter(Product.boss_number == body.boss_number).first()
    if existing:
        raise HTTPException(400, f"Produit BOSS {body.boss_number} existe déjà")
    product = Product(
        boss_number=body.boss_number,
        name=body.name,
        description=body.description,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return _to_response(product, db)


@router.get("/", response_model=List[ProductResponse])
def list_products(db: Session = Depends(get_db)):
    products = db.query(Product).filter(Product.active == True).order_by(Product.boss_number).all()
    return [_to_response(p, db) for p in products]


@router.get("/statuses")
def get_statuses():
    return {"statuses": [s.value for s in ProductStatus]}


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(404, f"Produit {product_id} introuvable")
    return _to_response(product, db)


@router.patch("/{product_id}", response_model=ProductResponse)
def update_product(product_id: int, body: ProductUpdate, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(404, f"Produit {product_id} introuvable")
    for field, value in body.dict(exclude_none=True).items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return _to_response(product, db)


@router.delete("/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(404, f"Produit {product_id} introuvable")
    product.active = False
    db.commit()
    return {"message": "Produit archivé"}


def _to_response(product: Product, db: Session) -> ProductResponse:
    doc_count = db.query(Document).filter(Document.product_id == product.id).count()
    return ProductResponse(
        id=product.id,
        boss_number=product.boss_number,
        name=product.name,
        description=product.description,
        status_referentiel=product.status_referentiel,
        status_fiche=product.status_fiche,
        status_parametrage=product.status_parametrage,
        status_recette=product.status_recette,
        document_count=doc_count,
        created_at=product.created_at.isoformat() if product.created_at else "",
    )
