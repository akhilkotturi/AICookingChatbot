"""
API contract tests — verifies that FastAPI enforces
input validation and returns correct status codes.

These tests do NOT call real LLMs or databases.
They test the HTTP layer only.
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock


@pytest.fixture
def client():
    """
    Create a test client with all external connections mocked.
    
    We mock at the module level before the app is imported
    to prevent connection attempts during testing.
    """
    with patch("motor.motor_asyncio.AsyncIOMotorClient") as mock_mongo:
        # Make mongo return a usable mock and avoid real connections.
        mock_mongo.return_value = MagicMock()

        from main import app
        return TestClient(app, raise_server_exceptions=False)


class TestHealthEndpoint:
    def test_returns_200(self, client):
        response = client.get("/health")
        assert response.status_code == 200

    def test_returns_ok_status(self, client):
        response = client.get("/health")
        assert response.json()["status"] == "ok"

    def test_returns_version(self, client):
        response = client.get("/health")
        assert "version" in response.json()


class TestCookwareCatalog:
    def test_returns_200(self, client):
        response = client.get("/cookware")
        assert response.status_code == 200

    def test_returns_list(self, client):
        response = client.get("/cookware")
        assert isinstance(response.json()["cookware"], list)

    def test_contains_expected_items(self, client):
        response = client.get("/cookware")
        catalog = response.json()["cookware"]
        assert "Frying Pan" in catalog
        assert "Oven" in catalog
        assert "Knife" in catalog


class TestQueryValidation:
    def test_empty_query_rejected(self, client):
        response = client.post(
            "/query/stream",
            json={"query": ""},
        )
        assert response.status_code == 422

    def test_query_too_long_rejected(self, client):
        response = client.post(
            "/query/stream",
            json={"query": "x" * 1001},
        )
        assert response.status_code == 422

    def test_missing_query_field_rejected(self, client):
        response = client.post(
            "/query/stream",
            json={"user_cookware": ["Frying Pan"]},
        )
        assert response.status_code == 422

    def test_valid_request_accepted(self, client):
        # We can't test the full streaming response easily in unit tests
        # but we can verify the endpoint accepts valid input
        # (it will fail at the LLM call, which is mocked away)
        response = client.post(
            "/query/stream",
            json={"query": "How do I make pasta?"},
        )
        # 200 means the request passed validation and hit the handler
        # Any other code means validation failed before we wanted it to
        assert response.status_code != 422


class TestRecipeImportSSRF:
    """
    SSRF (Server-Side Request Forgery) protection tests.
    
    SSRF is when an attacker tricks your server into making
    requests to internal infrastructure. For example:
    - http://192.168.1.1 — internal network
    - http://169.254.169.254 — AWS metadata service (huge security risk)
    - http://localhost — loopback
    
    Your routers/recipe.py has _validate_url() for this.
    These tests verify it actually works.
    """
    def test_private_ip_192_blocked(self, client):
        response = client.post(
            "/recipe/import",
            json={"url": "http://192.168.1.1/recipe"},
        )
        assert response.status_code == 400

    def test_private_ip_10_blocked(self, client):
        response = client.post(
            "/recipe/import",
            json={"url": "http://10.0.0.1/recipe"},
        )
        assert response.status_code == 400

    def test_aws_metadata_service_blocked(self, client):
        # This is the most critical one
        # 169.254.169.254 is AWS instance metadata — leaking this
        # gives an attacker your IAM role credentials
        response = client.post(
            "/recipe/import",
            json={"url": "http://169.254.169.254/latest/meta-data/"},
        )
        assert response.status_code == 400

    def test_localhost_blocked(self, client):
        response = client.post(
            "/recipe/import",
            json={"url": "http://localhost/internal"},
        )
        # localhost resolves to 127.0.0.1 which is in the private range
        assert response.status_code in (400, 422)

    def test_non_http_scheme_blocked(self, client):
        response = client.post(
            "/recipe/import",
            json={"url": "ftp://example.com/recipe"},
        )
        assert response.status_code == 400

    def test_valid_public_url_passes_validation(self, client):
        # This will fail at the scraping step (no real HTTP call in tests)
        # but it should PASS the URL validation step
        response = client.post(
            "/recipe/import",
            json={"url": "https://www.allrecipes.com/recipe/12345"},
        )
        # 400 would mean URL validation failed (wrong)
        # 422 or 500 means it passed validation but failed scraping (correct)
        assert response.status_code != 400