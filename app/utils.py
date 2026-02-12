import re

def get_plain_text(html: str) -> str:
    """
    Strips HTML tags and removes base64 image data to get plain text.
    """
    if not html:
        return ""
    # Remove base64 data first (images)
    text = re.sub(r'data:[^;]+;base64,[A-Za-z0-9+/=]+', '', html)
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', ' ', text)
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text.lower()
