from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from .. import models

async def export_all_to_html(db: AsyncSession) -> str:
    result = await db.execute(select(models.Document))
    docs = result.scalars().all()
    
    # Build tree structure
    doc_map = {doc.id: doc for doc in docs}
    roots = []
    children_map = {}  # parent_id -> [children]
    
    for doc in docs:
        if doc.parent_id is None:
            roots.append(doc)
        else:
            if doc.parent_id not in children_map:
                children_map[doc.parent_id] = []
            children_map[doc.parent_id].append(doc)
    
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>All Documents Export</title>
        <style>
            body { font-family: sans-serif; line-height: 1.6; max-width: 900px; margin: 40px auto; padding: 20px; }
            h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; color: #333; }
            .document { margin-bottom: 20px; }
            .children { margin-left: 40px; padding-left: 20px; }
            .doc-separator { margin: 30px 0; border-top: 1px dashed #ccc; }
            img { max-width: 100%; height: auto; border-radius: 8px; }
            .tree-indicator { display: none; }
        </style>
    </head>
    <body>
    """
    
    def render_doc(doc, depth=0):
        nonlocal html
        parent_id_attr = f"data-parent-id='{doc.parent_id}'" if doc.parent_id else ""
        depth_indicator = "└── " if depth > 0 else ""
        
        html += f"<div class='document' id='doc-{doc.id}' data-id='{doc.id}' {parent_id_attr}>"
        if depth > 0:
            html += f"<div class='tree-indicator'>{depth_indicator}</div>"
        html += f"<h1>{doc.title}</h1>"
        html += f"<div>{doc.content}</div>"
        
        # Render children
        if doc.id in children_map:
            html += "<div class='children'>"
            for child in children_map[doc.id]:
                render_doc(child, depth + 1)
            html += "</div>"
        
        html += "</div>"
        if depth == 0:
            html += "<div class='doc-separator'></div>"
    
    for root in roots:
        render_doc(root, 0)
            
    html += "</body></html>"
    return html
