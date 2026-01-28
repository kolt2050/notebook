from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
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
    result = await db.execute(select(models.Document).order_by(models.Document.position, models.Document.id))
    docs = result.scalars().all()
    
    # Build a recursive tree from the flat list manually to avoid lazy-loading issues
    doc_map = {doc.id: schemas.TreeItem(
        id=doc.id,
        title=doc.title,
        is_folder=doc.is_folder,
        parent_id=doc.parent_id,
        position=doc.position,
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

@app.get("/api/stats/count")
async def get_document_count(db: AsyncSession = Depends(database.get_db)):
    result = await db.execute(select(func.count()).select_from(models.Document))
    count = result.scalar()
    return {"count": count}

@app.get("/api/search")
async def search_documents(q: str = "", db: AsyncSession = Depends(database.get_db)):
    import re
    
    if len(q) < 1:
        return {"matches": [], "ancestors": []}
    
    query_lower = q.lower()
    
    # Get all documents
    result = await db.execute(select(models.Document))
    all_docs = result.scalars().all()
    all_docs_map = {doc.id: doc for doc in all_docs}
    
    # Helper to strip HTML tags and get plain text
    def get_plain_text(html: str) -> str:
        if not html:
            return ""
        # Remove base64 data first (images)
        text = re.sub(r'data:[^;]+;base64,[A-Za-z0-9+/=]+', '', html)
        # Remove HTML tags
        text = re.sub(r'<[^>]+>', ' ', text)
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        return text.lower()
    
    # Search in title and plain text content
    match_ids = set()
    for doc in all_docs:
        title_match = query_lower in doc.title.lower()
        content_match = query_lower in get_plain_text(doc.content)
        if title_match or content_match:
            match_ids.add(doc.id)
    
    # Find all ancestors to preserve tree structure
    ancestor_ids = set()
    for doc_id in match_ids:
        doc = all_docs_map.get(doc_id)
        if doc:
            parent_id = doc.parent_id
            while parent_id is not None:
                ancestor_ids.add(parent_id)
                parent_doc = all_docs_map.get(parent_id)
                parent_id = parent_doc.parent_id if parent_doc else None
    
    return {
        "matches": list(match_ids),
        "ancestors": list(ancestor_ids - match_ids)
    }

@app.post("/api/documents", response_model=schemas.DocumentResponse)
async def create_document(doc: schemas.DocumentCreate, db: AsyncSession = Depends(database.get_db)):
    if doc.parent_id is not None and doc.parent_id <= 0: # Handle possible invalid IDs
        doc.parent_id = None
        
    db_doc = models.Document(**doc.dict())
    db.add(db_doc)
    await db.commit()
    await db.refresh(db_doc)
    
    # Safety check after creation (though ID isn't known before)
    if db_doc.parent_id == db_doc.id:
        db_doc.parent_id = None
        await db.commit()
        await db.refresh(db_doc)
        
    return db_doc

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
    
    # Prevent self-referencing
    if "parent_id" in update_data and update_data["parent_id"] == doc_id:
        update_data["parent_id"] = None

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

@app.delete("/api/danger/all", status_code=status.HTTP_204_NO_CONTENT)
async def delete_all_documents(db: AsyncSession = Depends(database.get_db)):
    await db.execute(delete(models.Document))
    await db.execute(delete(models.Image))
    await db.commit()
    return None

@app.get("/api/export/all")
async def export_all(db: AsyncSession = Depends(database.get_db)):
    md = await export_service.export_all_to_markdown(db)
    return Response(
        content=md,
        media_type="text/markdown",
        headers={"Content-Disposition": "attachment; filename=notebook_export.md"}
    )

# Serve static files
app.mount("/", StaticFiles(directory="static", html=True), name="static")
