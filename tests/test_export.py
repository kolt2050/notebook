import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.export_service import export_all_to_markdown

@pytest.mark.asyncio
async def test_export_all_to_markdown_logic():
    # 1. Setup Mock documents
    mock_doc1 = MagicMock() # Regular mock for data objects
    mock_doc1.id = 1
    mock_doc1.title = "Root Doc"
    mock_doc1.content = "<p>Hello <strong>World</strong></p>"
    mock_doc1.parent_id = None
    mock_doc1.position = 0

    mock_doc2 = MagicMock()
    mock_doc2.id = 2
    mock_doc2.title = "Child Doc"
    mock_doc2.content = "<ul><li>Item 1</li></ul>"
    mock_doc2.parent_id = 1
    mock_doc2.position = 1

    # 2. Setup Mock DB Session
    mock_db = AsyncMock()
    mock_result = MagicMock() # Use MagicMock for synchronous method chains
    # scalars().all() returns our list of mock docs
    mock_result.scalars.return_value.all.return_value = [mock_doc1, mock_doc2]
    mock_db.execute.return_value = mock_result

    # 3. Call the service
    result = await export_all_to_markdown(mock_db)

    # 4. Assertions
    assert "<!-- notebook-bulk-export-v1 -->" in result
    assert "# Root Doc" in result
    assert "Hello **World**" in result
    assert '"id": 1' in result
    assert '"parent_id": null' in result
    
    assert "# Child Doc" in result
    assert "* Item 1" in result
    assert '"id": 2' in result
    assert '"parent_id": 1' in result
    assert '"position": 1' in result

    # Check that it includes separator
    assert "<!-- notebook-doc-separator -->" in result

@pytest.mark.asyncio
async def test_export_preserves_image_styles():
    # Setup mock doc with a resized image
    mock_doc = MagicMock()
    mock_doc.id = 1
    mock_doc.title = "Image Doc"
    # Resized image with style
    mock_doc.content = '<p>Check this: <img src="data:image/png;base64,123" style="width: 100px; height: 50px;" alt="Resized"></p>'
    mock_doc.parent_id = None
    mock_doc.position = 0

    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [mock_doc]
    mock_db.execute.return_value = mock_result

    result = await export_all_to_markdown(mock_db)

    # Check that the <img> tag with style is still there, isolated on its own line
    assert '\n\n<img src="data:image/png;base64,123" style="width: 100px; height: 50px;" alt="Resized">\n\n' in result
    # Ensure it's NOT converted to standard markdown image if it has style
    assert "![Resized](data:image/png;base64,123)" not in result
