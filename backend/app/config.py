import os
from pathlib import Path
from pydantic_settings import BaseSettings


BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    app_name: str = "KELIA Migration IA"
    app_version: str = "1.0.0"
    debug: bool = True

    # Database
    database_url: str = f"sqlite:///{BASE_DIR}/storage/db/kelia.db"

    # Storage
    storage_dir: str = str(BASE_DIR / "storage")
    documents_dir: str = str(BASE_DIR / "storage" / "documents")
    exports_dir: str = str(BASE_DIR / "storage" / "exports")

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    openai_model_fast: str = "gpt-4o-mini"
    openai_model_gpt5: str = "gpt-5"

    # Anthropic
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    anthropic_model_fast: str = "claude-haiku-4-5-20251001"

    # CORS
    allowed_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    class Config:
        env_file = str(BASE_DIR / ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
