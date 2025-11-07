#!/usr/bin/env python3
"""Start the FastAPI server with environment variables loaded"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
env_path = Path(__file__).parent / '.env'
if env_path.exists():
    load_dotenv(env_path)
    print(f"Loaded environment from {env_path}")
else:
    print(f"WARNING: .env file not found at {env_path}")

# Verify critical environment variables
if not os.getenv("DATABASE_URL"):
    print("ERROR: DATABASE_URL not set!")
    sys.exit(1)

if not os.getenv("ANTHROPIC_API_KEY"):
    print("ERROR: ANTHROPIC_API_KEY not set!")
    sys.exit(1)

print("✓ Environment variables loaded")
print(f"✓ DATABASE_URL: {os.getenv('DATABASE_URL')[:50]}...")
print(f"✓ ANTHROPIC_API_KEY: {os.getenv('ANTHROPIC_API_KEY')[:20]}...")

# Start uvicorn
import uvicorn
uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
