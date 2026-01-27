from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from . import models, schemas, database
from .services import export_service
from fastapi.responses import HTMLResponse, Response

app = FastAPI(title="Portable Notebook")

# Initialize DB on startup
@app.on_event("startup")
async def startup():
    await database.init_db()

# API Endpoints
@app.get("/api/tree", response_model=List[schemas.TreeItem])
async def get_tree(db: AsyncSession = Depends(database.get_db)):
    result = await db.execute(select(models.Document))
    docs = result.scalars().all()
    
    # Build a recursive tree from the flat list manually to avoid lazy-loading issues
    doc_map = {doc.id: schemas.TreeItem(
        id=doc.id,
        title=doc.title,
        is_folder=doc.is_folder,
        parent_id=doc.parent_id,
        children=[]
    ) for doc in docs}
    
    tree = []
    for doc in docs:
        item = doc_map[doc.id]
        if doc.parent_id is None:
            tree.append(item)
        else:
            parent = doc_map.get(doc.parent_id)
            if parent:
                parent.children.append(item)
    return tree

@app.post("/api/documents", response_model=schemas.DocumentResponse)
async def create_document(doc: schemas.DocumentCreate, db: AsyncSession = Depends(database.get_db)):
    new_doc = models.Document(**doc.dict())
    db.add(new_doc)
    await db.commit()
    await db.refresh(new_doc)
    return new_doc

@app.get("/api/documents/{doc_id}", response_model=schemas.DocumentResponse)
async def get_document(doc_id: int, db: AsyncSession = Depends(database.get_db)):
    result = await db.execute(select(models.Document).where(models.Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc

@app.put("/api/documents/{doc_id}", response_model=schemas.DocumentResponse)
async def update_document(doc_id: int, doc_update: schemas.DocumentUpdate, db: AsyncSession = Depends(database.get_db)):
    result = await db.execute(select(models.Document).where(models.Document.id == doc_id))
    db_doc = result.scalar_one_or_none()
    if not db_doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    update_data = doc_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_doc, key, value)
    
    await db.commit()
    await db.refresh(db_doc)
    return db_doc

@app.delete("/api/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(doc_id: int, db: AsyncSession = Depends(database.get_db)):
    result = await db.execute(select(models.Document).where(models.Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    await db.delete(doc)
    await db.commit()
    return None

@app.get("/api/export/all", response_class=HTMLResponse)
async def export_all(db: AsyncSession = Depends(database.get_db)):
    html = await export_service.export_all_to_html(db)
    return Response(
        content=html,
        media_type="text/html",
        headers={"Content-Disposition": "attachment; filename=notebook_export.html"}
    )

# Serve static files
app.mount("/", StaticFiles(directory="static", html=True), name="static")
