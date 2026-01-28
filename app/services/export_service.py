from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from .. import models
import json
import html2text
import re

async def export_all_to_markdown(db: AsyncSession) -> str:
    result = await db.execute(select(models.Document).order_by(models.Document.position, models.Document.id))
    docs = result.scalars().all()
    
    # Initialize html2text converter
    h = html2text.HTML2Text()
    h.body_width = 0
    h.ignore_links = False
    
    # Add a very explicit bulk export marker at the top
    md_content = "<!-- notebook-bulk-export-v1 -->\n# Notebook Export\n\n<!-- notebook-doc-separator -->\n\n"
    
    # Unordered list of documents, hierarchy is preserved in metadata
    for doc in docs:
        content = doc.content or ""
        
        # Protect <img> tags with style attributes (to preserve resized dimensions)
        protected_imgs = []
        def protect_img(match):
            placeholder = f"---IMG_PROTECT_{len(protected_imgs)}---"
            protected_imgs.append(match.group(0))
            return placeholder
        
        # Protect images with style OR width/height attributes
        content_with_placeholders = re.sub(r'<img[^>]+(?:style|width|height)=[^>]+>', protect_img, content)
        
        markdown_text = h.handle(content_with_placeholders)
        
        # Restore protected images, isolating them on their own lines for correct Markdown parsing
        for i, img_tag in enumerate(protected_imgs):
            placeholder = f"---IMG_PROTECT_{i}---"
            markdown_text = markdown_text.replace(placeholder, f"\n\n{img_tag}\n\n")
        
        # Clean up empty bold/italic markers like **, __, * *, etc.
        # These are often generated from <p><strong><br></strong></p> in contenteditable
        markdown_text = re.sub(r'(\*\*|__|^\*|^_)\s+\1', '', markdown_text) # Handles ** **, __ __
        markdown_text = re.sub(r'^\s*(\*\*|__|^\*|^_)\s*$', '', markdown_text, flags=re.MULTILINE) # Handles lone markers
        markdown_text = re.sub(r'\n\s*(\*+|_)\s*\n', '\n\n', markdown_text) # Handles lines with only asterisks/underscores
        
        md_content += f"# {doc.title}\n"
        
        metadata = {
            "id": doc.id,
            "parent_id": doc.parent_id,
            "title": doc.title,
            "position": doc.position
        }
        md_content += f"<!-- notebook-metadata: {json.dumps(metadata)} -->\n\n"
        md_content += f"{markdown_text}\n\n"
        md_content += "<!-- notebook-doc-separator -->\n\n"
            
    return md_content

async def export_all_to_html(db: AsyncSession) -> str:
    # Deprecated in favor of Markdown bulk export
    return "Export to HTML is deprecated. Use Markdown export via /api/export/all"
