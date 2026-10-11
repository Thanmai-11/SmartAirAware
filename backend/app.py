import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from db.seed import seed_db
from backend.routes.api import router as api_router

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_db()
    yield

app = FastAPI(
    title="SmartAirAware API",
    description="Intelligent Air Quality and HVAC Demand Flexibility Optimization Engine",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    # allow_credentials=True requires an explicit origin list — wildcards are
    # rejected by browsers when credentials are included.  Use the env var
    # CORS_ORIGINS (comma-separated) to supply allowed origins; fall back to
    # localhost defaults so local development works out of the box.
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

@app.get("/")
def root():
    return {"name": "SmartAirAware API", "status": "running"}

@app.get("/api/health")
def health():
    return {"status": "ok"}
