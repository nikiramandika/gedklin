"""Isi data awal: akun owner dan layanan CK/CKS.

python -m app.seed
"""

from decimal import Decimal

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Role, Service, ServiceType, User
from app.security import hash_password

# TODO: sesuaikan harga dengan daftar harga mitra.
DEFAULT_SERVICES = [
    (ServiceType.CK, "Cuci Kering", Decimal("6000"), Decimal("10000")),
    (ServiceType.CKS, "Cuci Kering Setrika", Decimal("8000"), Decimal("13000")),
]


def main() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        for code, name, regular, express in DEFAULT_SERVICES:
            if db.scalar(select(Service).where(Service.code == code)) is None:
                db.add(
                    Service(
                        code=code,
                        name=name,
                        price_per_kg_regular=regular,
                        price_per_kg_express=express,
                    )
                )
                print(f"Layanan {code} dibuat")

        username = settings.seed_owner_username
        if db.scalar(select(User).where(User.username == username)) is None:
            if not settings.seed_owner_password:
                raise SystemExit("Set SEED_OWNER_PASSWORD di .env sebelum seeding akun owner")
            db.add(
                User(
                    name="Pemilik",
                    username=username,
                    password_hash=hash_password(settings.seed_owner_password),
                    role=Role.OWNER,
                    is_active=True,
                )
            )
            print(f"Akun owner '{username}' dibuat")
        db.commit()


if __name__ == "__main__":
    main()
