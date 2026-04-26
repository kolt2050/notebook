import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from sqlalchemy import event
from sqlalchemy.engine import Engine

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./data/notebook.db")

engine = create_async_engine(DATABASE_URL, echo=True)

@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

async_session = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

def recreate_engine():
    """Re-create the async engine and sessionmaker after database file replacement.
    
    This is needed after importing a new .db file, because the old engine's
    connection pool may reference the deleted/replaced file. Disposing alone
    doesn't guarantee fresh connections on all platforms (especially Windows).
    """
    global engine, async_session
    # Dispose the old engine (releases any remaining pooled connections)
    # Note: this is synchronous but safe because dispose() on an already-disposed
    # engine is a no-op, and we need to ensure no stale connections remain.
    engine = create_async_engine(DATABASE_URL, echo=True)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

async def get_db():
    async with async_session() as session:
        yield session

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
