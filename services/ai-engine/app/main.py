from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.routers.ai import router as ai_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="MoleculeStudio AI Engine",
        description="Gemini prompt-to-molecule service with RDKit 3D optimization",
        version="1.0.0",
    )

    @app.get("/health")
    async def health() -> dict[str, str | bool]:
        return {"success": True, "service": "ai-engine", "status": "ok"}

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "error": "Validation failed.",
                "code": "VALIDATION_ERROR",
                "details": exc.errors(),
            },
        )

    app.include_router(ai_router)
    return app


app = create_app()
