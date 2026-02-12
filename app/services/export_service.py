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
        
        # === Step 1: Protect <img> tags with style attributes (preserve resized dimensions) ===
        protected_imgs = []
        def protect_img(match):
            placeholder = f"---IMG_PROTECT_{len(protected_imgs)}---"
            protected_imgs.append(match.group(0))
            return placeholder
        
        content = re.sub(r'<img[^>]+(?:style|width|height)=[^>]+>', protect_img, content)
        
        # === Step 2: Extract <pre> blocks and replace with placeholders ===
        protected_code_blocks = []
        def protect_pre(match):
            pre_html = match.group(0)
            placeholder = f"---CODE_BLOCK_{len(protected_code_blocks)}---"
            
            # Extract language from <code class="language-xxx">
            lang_match = re.search(r'class="[^"]*language-(\w+)', pre_html)
            lang = lang_match.group(1) if lang_match else ''
            # Strip "hljs" if it's the only language
            if lang == 'hljs':
                lang = ''
            
            # Extract plain text (strip all HTML tags inside <pre>)
            text = re.sub(r'<[^>]+>', '', pre_html)
            # Unescape HTML entities
            text = text.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&').replace('&quot;', '"')
            text = text.strip('\n')
            
            protected_code_blocks.append((lang, text))
            return placeholder
        
        content = re.sub(r'<pre[^>]*>.*?</pre>', protect_pre, content, flags=re.DOTALL)
        
        # === Step 2.5: Normalize div structure for proper line breaks ===
        # Editor uses <div> for each line. html2text treats <div> as paragraph (double newline).
        # Fix: empty divs = blank lines, consecutive content divs = single line breaks.
        
        # First: replace empty divs (blank line indicators) with <br><br> (paragraph break)
        content = re.sub(r'<div>\s*(?:<br\s*/?>)?\s*</div>', '<br><br>', content)
        
        # Then: replace </div><div> boundaries between content divs with <br> (line break)
        content = re.sub(r'</div>\s*<div(?:\s[^>]*)?>', '<br>', content)
        
        # Strip remaining opening/closing div tags
        content = re.sub(r'</?div(?:\s[^>]*)?>', '', content)
        
        # === Step 3: Convert remaining HTML to markdown ===
        markdown_text = h.handle(content)
        
        # === Step 4: Restore protected images ===
        for i, img_tag in enumerate(protected_imgs):
            placeholder = f"---IMG_PROTECT_{i}---"
            markdown_text = markdown_text.replace(placeholder, img_tag)
        
        # === Step 5: Restore code blocks as fenced markdown ===
        for i, (lang, text) in enumerate(protected_code_blocks):
            placeholder = f"---CODE_BLOCK_{i}---"
            fenced = f"\n```{lang}\n{text}\n```\n"
            markdown_text = markdown_text.replace(placeholder, fenced)
        
        # === Step 6: Post-processing cleanup ===
        # Remove stray backslashes before tags or newlines
        markdown_text = re.sub(r'\\(?=\s*<)', '', markdown_text)
        markdown_text = re.sub(r'\\\s*\n', '\n', markdown_text)
        
        # Clean up empty bold/italic markers
        markdown_text = re.sub(r'^\s*(\*\*|__)\s*$', '', markdown_text, flags=re.MULTILINE)
        markdown_text = re.sub(r'\n\s*(\*+|_)\s*\n', '\n\n', markdown_text)
        
        # Unescape markdown special chars (list markers)
        markdown_text = re.sub(r'^\\-', '-', markdown_text, flags=re.MULTILINE)
        markdown_text = re.sub(r'^(\s*)\\(\d+)\.', r'\1\2.', markdown_text, flags=re.MULTILINE)
        # Also unescape \. after digits anywhere (html2text escapes N. patterns)
        markdown_text = re.sub(r'(\d)\\\.', r'\1.', markdown_text)
        # Unescape underscores (e.g. "name\_suffix" → "name_suffix")
        markdown_text = markdown_text.replace('\\_', '_')
        
        # Clean whitespace-only lines, then collapse 3+ newlines to 2
        markdown_text = re.sub(r'^\s+$', '', markdown_text, flags=re.MULTILINE)
        markdown_text = re.sub(r'\n{3,}', '\n\n', markdown_text).strip()
        
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
