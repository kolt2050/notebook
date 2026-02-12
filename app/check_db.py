import asyncio
from sqlalchemy import select, update
from app.database import engine
from app.models import Document

async def fix_links():
    async with engine.connect() as conn:
        # 1. Parent points to itself
        stmt1 = update(Document).where(Document.parent_id == Document.id).values(parent_id=None)
        res1 = await conn.execute(stmt1)
        print(f"Fixed {res1.rowcount} self-referencing documents.")
        
        # 2. Parent points to non-existent id
        subquery = select(Document.id)
        stmt2 = update(Document).where(
            Document.parent_id.isnot(None),
            ~Document.parent_id.in_(subquery)
        ).values(parent_id=None)
        res2 = await conn.execute(stmt2)
        print(f"Fixed {res2.rowcount} orphan documents (reset to root).")
        
        await conn.commit()

if __name__ == "__main__":
    asyncio.run(fix_links())
