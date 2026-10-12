import os
import tempfile
from collections.abc import Iterator
from decimal import Decimal

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ["CELERY_TASK_ALWAYS_EAGER"] = "true"
os.environ["MODEL_PATH"] = ""
os.environ["WA_PROVIDER"] = "console"
os.environ["JWT_SECRET"] = "test-secret-yang-cukup-panjang-untuk-hs256"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Role, Service, ServiceType, User  # noqa: E402
from app.security import hash_password  # noqa: E402

PASSWORD = "rahasia123"


@pytest.fixture(autouse=True)
def schema() -> Iterator[None]:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        db.add_all(
            [
                Service(
                    code=ServiceType.CK,
                    name="Cuci Kering",
                    price_per_kg_regular=Decimal("6000"),
                    price_per_kg_express=Decimal("10000"),
                ),
                Service(
                    code=ServiceType.CKS,
                    name="Cuci Kering Setrika",
                    price_per_kg_regular=Decimal("8000"),
                    price_per_kg_express=Decimal("13000"),
                ),
            ]
        )
        for role in Role:
            db.add(
                User(
                    name=role.value.title(),
                    username=role.value,
                    password_hash=hash_password(PASSWORD),
                    role=role,
                    is_active=True,
                )
            )
        db.commit()
    yield


@pytest.fixture
def db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def login(client: TestClient, username: str) -> dict[str, str]:
    res = client.post("/auth/login", json={"username": username, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture
def cashier(client: TestClient) -> dict[str, str]:
    return login(client, "cashier")


@pytest.fixture
def owner(client: TestClient) -> dict[str, str]:
    return login(client, "owner")


@pytest.fixture
def admin(client: TestClient) -> dict[str, str]:
    return login(client, "admin")


def new_order(client: TestClient, headers: dict[str, str], **overrides: object) -> dict:
    payload = {
        "customer_name": "Budi",
        "customer_phone": "0812-3456-7890",
        "service_type": "CK",
        "is_express": False,
        "weight_kg": 3.5,
        **overrides,
    }
    res = client.post("/orders", json=payload, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()
