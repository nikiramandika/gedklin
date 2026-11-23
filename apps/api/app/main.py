import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import (
    activity,
    auth,
    customers,
    followups,
    orders,
    owner,
    reports,
    tracking,
    work,
)

logging.basicConfig(level=logging.INFO)

settings = get_settings()
app = FastAPI(title="Gedklin API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(orders.router)
app.include_router(owner.router)
app.include_router(followups.router)
app.include_router(work.router)
app.include_router(tracking.router)
app.include_router(activity.router)
app.include_router(customers.router)
app.include_router(reports.router)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
