from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from typing import List, Optional, Set
from .. import models, schemas
from ..utils import get_plain_text
from ..exceptions import DocumentNotFoundError

class DocumentService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_tree(self) -> List[schemas.TreeItem]:
        result = await self.db.execute(
            select(models.Document).order_by(models.Document.position, models.Document.id)
        )
        docs = result.scalars().all()
        
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

    async def get_document_count(self) -> int:
        result = await self.db.execute(select(func.count()).select_from(models.Document))
        return result.scalar() or 0

    async def search_documents(self, q: str) -> dict:
        if len(q) < 1:
            return {"matches": [], "ancestors": []}
        
        query_lower = q.lower()
        result = await self.db.execute(select(models.Document))
        all_docs = result.scalars().all()
        all_docs_map = {doc.id: doc for doc in all_docs}
        
        match_ids = set()
        for doc in all_docs:
            title_match = query_lower in doc.title.lower()
            content_match = query_lower in get_plain_text(doc.content)
            if title_match or content_match:
                match_ids.add(doc.id)
        
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

    async def create_document(self, doc_data: schemas.DocumentCreate) -> models.Document:
        data = doc_data.dict()
        if data.get("parent_id") is not None and data["parent_id"] <= 0:
            data["parent_id"] = None
            
        db_doc = models.Document(**data)
        self.db.add(db_doc)
        await self.db.commit()
        await self.db.refresh(db_doc)
        
        if db_doc.parent_id == db_doc.id:
            db_doc.parent_id = None
            await self.db.commit()
            await self.db.refresh(db_doc)
            
        return db_doc

    async def get_document(self, doc_id: int) -> models.Document:
        result = await self.db.execute(select(models.Document).where(models.Document.id == doc_id))
        doc = result.scalar_one_or_none()
        if not doc:
            raise DocumentNotFoundError()
        return doc

    async def update_document(self, doc_id: int, doc_update: schemas.DocumentUpdate) -> models.Document:
        db_doc = await self.get_document(doc_id)
        
        update_data = doc_update.dict(exclude_unset=True)
        if "parent_id" in update_data and update_data["parent_id"] == doc_id:
            update_data["parent_id"] = None

        for key, value in update_data.items():
            setattr(db_doc, key, value)
        
        await self.db.commit()
        await self.db.refresh(db_doc)
        return db_doc

    async def delete_document(self, doc_id: int) -> None:
        db_doc = await self.get_document(doc_id)
        await self.db.delete(db_doc)
        await self.db.commit()

    async def delete_all(self) -> None:
        await self.db.execute(delete(models.Document))
        await self.db.execute(delete(models.Image))
        await self.db.commit()
