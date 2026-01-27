from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class DocumentBase(BaseModel):
    title: str
    parent_id: Optional[int] = None
    is_folder: int = 0

class DocumentCreate(DocumentBase):
    content: Optional[str] = ""

class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    parent_id: Optional[int] = None

class DocumentResponse(DocumentBase):
    id: int
    content: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class TreeItem(BaseModel):
    id: int
    title: str
    is_folder: int
    parent_id: Optional[int]
    children: List['TreeItem'] = []

    class Config:
        from_attributes = True

class ImageResponse(BaseModel):
    id: int
    filename: str
    content_type: str

    class Config:
        from_attributes = True
