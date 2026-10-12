from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://gedklin:gedklin@localhost:5432/gedklin"
    redis_url: str = "redis://localhost:6379/0"
    model_path: str = "../../ml/models/best_model.joblib"

    # Menunggu kesepakatan mitra.
    delay_threshold_minutes: int = 30
    max_delay_notifications: int = 2
    followup_after_days: int = 3
    # ETA yang sudah lewat tapi pesanan belum READY digeser ke now + buffer ini.
    overdue_buffer_minutes: int = 30

    wa_provider: str = "console"
    wa_api_key: str = ""

    jwt_secret: str = "dev-secret-ganti-di-production"
    jwt_expire_minutes: int = 60 * 12
    cors_origins: str = "http://localhost:3000"
    public_tracking_url: str = "http://localhost:3000/lacak"

    celery_task_always_eager: bool = False

    seed_owner_username: str = "owner"
    seed_owner_password: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
