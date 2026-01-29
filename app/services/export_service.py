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
        
        # Restore protected images WITHOUT adding manual newlines (as per user request)
        for i, img_tag in enumerate(protected_imgs):
            placeholder = f"---IMG_PROTECT_{i}---"
            markdown_text = markdown_text.replace(placeholder, img_tag)
        
        # Aggressively remove stray backslashes that html2text adds before tags or newlines
        markdown_text = re.sub(r'\\(?=\s*<)', '', markdown_text)
        markdown_text = re.sub(r'\\\s*\n', '\n', markdown_text)
        
        # Clean up empty bold/italic markers like **, __, * *, etc.
        markdown_text = re.sub(r'(\*\*|__|^\*|^_)\s+\1', '', markdown_text)
        markdown_text = re.sub(r'^\s*(\*\*|__|^\*|^_)\s*$', '', markdown_text, flags=re.MULTILINE)
        markdown_text = re.sub(r'\n\s*(\*+|_)\s*\n', '\n\n', markdown_text)
        
        # FINAL NORMALIZATION: collapse any sequence of 4+ newlines to exactly 3 (2 blank lines)
        markdown_text = re.sub(r'(\r?\n\s*){4,}', '\n\n\n', markdown_text).strip()
        
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
