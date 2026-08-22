#!/usr/bin/env python3
"""Dev entrypoint: uvicorn app.main:app --reload"""

import uvicorn

from app.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.env != "production",
    )
