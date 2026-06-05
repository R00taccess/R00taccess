import pytest

@pytest.fixture(autouse=True)
def mock_db_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://ridesignal:ridesignal@localhost:5432/ridesignal")
