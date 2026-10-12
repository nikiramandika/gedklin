import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import admin, auth, orders, owner, tracking
from app.services.eta import get_predictor

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
app.include_router(admin.router)
app.include_router(tracking.router)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok", "model_version": get_predictor().model_version}
