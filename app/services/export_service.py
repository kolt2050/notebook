from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from .. import models

async def export_all_to_html(db: AsyncSession) -> str:
    result = await db.execute(select(models.Document).order_by(models.Document.parent_id.asc(), models.Document.id.asc()))
    docs = result.scalars().all()
    
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>All Documents Export</title>
        <style>
            body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 20px; }
            h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; color: #333; }
            .doc-separator { margin: 50px 0; border-top: 1px dashed #ccc; }
            img { max-width: 100%; height: auto; border-radius: 8px; }
        </style>
    </head>
    <body>
    """
    
    for doc in docs:
        if not doc.is_folder:
            html += f"<div class='document' id='doc-{doc.id}'>"
            html += f"<h1>{doc.title}</h1>"
            html += f"<div>{doc.content}</div>"
            html += "</div>"
            html += "<div class='doc-separator'></div>"
            
    html += "</body></html>"
    return html
