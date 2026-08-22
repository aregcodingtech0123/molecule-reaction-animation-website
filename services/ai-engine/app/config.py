from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    host: str = "0.0.0.0"
    port: int = 8000
    env: str = "development"

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"

    billing_service_url: str = ""
    internal_api_key: str = ""
    credit_cost_per_generation: int = 1


settings = Settings()
