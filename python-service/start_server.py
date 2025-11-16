#!/usr/bin/env python3
"""Start the FastAPI server with environment variables loaded"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Check Python version compatibility
REQUIRED_PYTHON = (3, 11)
MAXIMUM_PYTHON = (3, 14)

if sys.version_info < REQUIRED_PYTHON:
    sys.stderr.write(f"ERROR: Python {REQUIRED_PYTHON[0]}.{REQUIRED_PYTHON[1]} or higher is required.\n")
    sys.stderr.write(f"You are using Python {sys.version_info.major}.{sys.version_info.minor}.\n")
    sys.stderr.write("Please install Python 3.11 or 3.12 and try again.\n")
    sys.exit(1)

if sys.version_info >= MAXIMUM_PYTHON:
    sys.stderr.write(f"ERROR: Python {sys.version_info.major}.{sys.version_info.minor} is not yet supported.\n")
    sys.stderr.write(f"This application requires Python 3.11, 3.12, or 3.13 due to package compatibility.\n")
    sys.stderr.write("Some packages (like asyncpg) may not have pre-built wheels for Python 3.14+ yet.\n")
    sys.stderr.write("Please use Python 3.12 (recommended) or 3.11.\n")
    sys.exit(1)

print(f"[OK] Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")

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

print("[OK] Environment variables loaded")
print(f"[OK] DATABASE_URL: {os.getenv('DATABASE_URL')[:50]}...")
print(f"[OK] ANTHROPIC_API_KEY: {os.getenv('ANTHROPIC_API_KEY')[:20]}...")

# Start uvicorn
import uvicorn
uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
