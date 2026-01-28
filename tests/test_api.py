from fastapi.testclient import TestClient
from app.main import app
import pytest

client = TestClient(app)

def test_read_root():
    # Test that the index page serves correctly
    response = client.get("/")
    assert response.status_code == 200

def test_get_stats_count():
    # Test stats endpoint (might return 0 or more depending on state, 
    # but should return a valid 200 OK)
    response = client.get("/api/stats/count")
    assert response.status_code == 200
    data = response.json()
    assert "count" in data

@pytest.mark.asyncio
async def test_tree_endpoint_returns_list():
    # Even if empty, /api/tree should return a list
    response = client.get("/api/tree")
    assert response.status_code == 200
    assert isinstance(response.json(), list)
