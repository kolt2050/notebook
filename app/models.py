from sqlalchemy import Column, Integer, String, Text, ForeignKey, BLOB, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    parent_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    title = Column(String, index=True, nullable=False)
    content = Column(Text, default="")
    is_folder = Column(Integer, default=0) # 0 for doc, 1 for folder
    position = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    parent = relationship("Document", remote_side=[id], back_populates="children")
    children = relationship("Document", back_populates="parent", cascade="all, delete-orphan")
    images = relationship("Image", back_populates="document", cascade="all, delete-orphan")

class Image(Base):
    __tablename__ = "images"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    filename = Column(String)
    data = Column(BLOB)
    content_type = Column(String)

    document = relationship("Document", back_populates="images")
