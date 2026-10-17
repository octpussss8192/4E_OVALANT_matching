"""OVALANT 3v3 Matching System FastAPI Application."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api import router

app = FastAPI(
    title="OVALANT Matching API",
    description="3v3 IR Survival Game Realtime Matching & Queue Management System",
    version="1.0.0",
)

# CORS設定 (Next.js フロントエンドからのアクセスを許可)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ovalant-matching-backend"}
