import sys
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.main import app

@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test') as ac:
        yield ac

@pytest.mark.asyncio
async def test_ping(client):
    response = await client.get('/api/health/ping')
    assert response.status_code == 200
    assert response.json()['status'] == 'ok'

@pytest.mark.asyncio
async def test_health_check(client):
    response = await client.get('/api/health')
    assert response.status_code == 200
