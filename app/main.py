from fastapi import FastAPI, Depends, HTTPException, status, Request, UploadFile, File
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Annotated
from . import models, schemas, database, exceptions
from .services import export_service
from .services.document_service import DocumentService
from fastapi.responses import HTMLResponse, Response, JSONResponse, FileResponse
import os
import shutil
import asyncio

app = FastAPI(title="Portable Notebook")

# Exception Handlers
@app.exception_handler(exceptions.DocumentNotFoundError)
async def document_not_found_handler(request: Request, exc: exceptions.DocumentNotFoundError):
    return JSONResponse(
        status_code=404,
        content={"detail": "Document not found"},
    )

@app.exception_handler(exceptions.AppException)
async def app_exception_handler(request: Request, exc: exceptions.AppException):
    return JSONResponse(
        status_code=400,
        content={"detail": str(exc)},
    )

# Dependencies
def get_document_service(db: AsyncSession = Depends(database.get_db)) -> DocumentService:
    return DocumentService(db)

# Async Dependencies with Annotated (Modern FASTApi)
DocService = Annotated[DocumentService, Depends(get_document_service)]
DB_Session = Annotated[AsyncSession, Depends(database.get_db)]

# Initialize DB on startup
@app.on_event("startup")
async def startup():
    await database.init_db()

# API Endpoints
@app.get("/api/tree", response_model=List[schemas.TreeItem])
async def get_tree(service: DocService):
    return await service.get_tree()

@app.get("/api/stats/count")
async def get_document_count(service: DocService):
    count = await service.get_document_count()
    return {"count": count}

@app.get("/api/search")
async def search_documents(service: DocService, q: str = ""):
    return await service.search_documents(q)

@app.post("/api/documents", response_model=schemas.DocumentResponse)
async def create_document(doc: schemas.DocumentCreate, service: DocService):
    return await service.create_document(doc)

@app.get("/api/documents/{doc_id}", response_model=schemas.DocumentResponse)
async def get_document(doc_id: int, service: DocService):
    return await service.get_document(doc_id)

@app.put("/api/documents/{doc_id}", response_model=schemas.DocumentResponse)
async def update_document(doc_id: int, doc_update: schemas.DocumentUpdate, service: DocService):
    return await service.update_document(doc_id, doc_update)

@app.delete("/api/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(doc_id: int, service: DocService):
    await service.delete_document(doc_id)
    return None

@app.delete("/api/danger/all", status_code=status.HTTP_204_NO_CONTENT)
async def delete_all_documents(service: DocService):
    await service.delete_all()
    return None

@app.get("/api/export/all")
async def export_all(db: DB_Session):
    md = await export_service.export_all_to_markdown(db)
    return Response(
        content=md,
        media_type="text/markdown",
        headers={"Content-Disposition": "attachment; filename=notebook_export.md"}
    )

@app.get("/api/backup/db")
async def backup_db():
    db_path = os.path.join("data", "notebook.db")
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail="Database file not found")
    return FileResponse(
        db_path,
        media_type="application/x-sqlite3",
        filename="notebook.backup.db"
    )

def _resolve_db_path() -> str:
    """Resolve the database file path from DATABASE_URL or fallback to default."""
    url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./data/notebook.db")
    # Extract path from SQLite URL like: sqlite+aiosqlite:///./data/notebook.db
    # or sqlite+aiosqlite:////app/data/notebook.db (absolute path with 4 slashes)
    if ":///" in url:
        path_part = url.split(":///", 1)[1]
        # If path starts with /, it's absolute; otherwise relative
        if path_part.startswith("/"):
            return path_part
        else:
            return os.path.join(os.getcwd(), path_part)
    return os.path.join(os.getcwd(), "data", "notebook.db")


async def _do_import_db(content: bytes, filename: str):
    """Core logic for importing a database file."""
    if not filename or not filename.endswith('.db'):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a .db file.")

    db_path = _resolve_db_path()
    tmp_path = db_path + ".tmp"

    # 1. Close all connections in the pool and wait briefly for them to release
    await database.engine.dispose()
    await asyncio.sleep(0.2)

    try:
        # 2. Write uploaded content to a temp file first (avoids partial writes on error)
        with open(tmp_path, "wb") as buffer:
            buffer.write(content)

        # 3. Replace the old database file with the new one
        if os.path.exists(db_path):
            os.remove(db_path)
        shutil.move(tmp_path, db_path)

        # 4. Re-create the async engine so new connections use the imported DB
        database.recreate_engine()

        # 5. Ensure tables exist (in case imported DB has different schema)
        await database.init_db()

        return {"status": "success", "message": "Database imported successfully"}
    except Exception as e:
        # Clean up temp file if it still exists
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
        # Try to recover the engine even on failure
        database.recreate_engine()
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")


@app.post("/api/import/db")
async def import_db(request: Request):
    """Import database from multipart form data."""
    form = await request.form()
    file = form.get("file")
    if not file:
        raise HTTPException(status_code=400, detail="No file provided")
    content = await file.read()
    return await _do_import_db(content, file.filename)


@app.post("/api/import/db/upload")
async def import_db_upload(file: UploadFile = File(...)):
    """Import database from UploadFile (alternative endpoint for compatibility)."""
    content = await file.read()
    return await _do_import_db(content, file.filename)

# Serve static files
app.mount("/", StaticFiles(directory="static", html=True), name="static")
