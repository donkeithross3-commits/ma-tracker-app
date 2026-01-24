#!/bin/bash
# Start the Python FastAPI service for M&A Options Scanner
# This service connects to Interactive Brokers TWS for options data

set -e

PROJECT_ROOT="/Users/donaldross/dev/ma-tracker-app"
PYTHON_SERVICE_DIR="$PROJECT_ROOT/python-service"

echo "=========================================="
echo "🐍 Starting Python Service"
echo "=========================================="
echo ""

# Check if Python 3.11+ is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ python3 not found"
    echo "Please install Python 3.11 or higher"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
echo "✅ Python $PYTHON_VERSION found"
echo ""

# Check if .env file exists
if [ ! -f "$PYTHON_SERVICE_DIR/.env" ]; then
    echo "❌ .env file not found at $PYTHON_SERVICE_DIR/.env"
    echo ""
    echo "Creating .env file with default settings..."
    cat > "$PYTHON_SERVICE_DIR/.env" << 'EOF'
# Database
DATABASE_URL=postgresql://donaldross@localhost:5432/ma_tracker

# Interactive Brokers Connection
IB_HOST=127.0.0.1
IB_PORT=7497

# Server Configuration
PORT=8000
HOST=0.0.0.0

# CORS Origins
ALLOWED_ORIGINS=http://localhost:3000

# Anthropic API (required by start_server.py validation)
ANTHROPIC_API_KEY=placeholder_for_options_scanner_only
EOF
    echo "✅ .env file created"
    echo ""
fi

# Check if IB TWS is running
echo "Checking IB TWS connection..."
if nc -z 127.0.0.1 7497 2>/dev/null; then
    echo "✅ IB TWS is running on port 7497"
else
    echo "⚠️  WARNING: IB TWS does not appear to be running on port 7497"
    echo "   The options scanner will not work without IB TWS"
    echo "   Please start IB TWS and ensure API is enabled"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi
echo ""

# Check if dependencies are installed
echo "Checking Python dependencies..."
if ! python3 -c "import uvicorn" 2>/dev/null; then
    echo "⚠️  Dependencies not installed"
    echo "Installing dependencies from requirements.txt..."
    cd "$PYTHON_SERVICE_DIR"
    pip3 install -r requirements.txt
    echo "✅ Dependencies installed"
    echo ""
else
    echo "✅ Dependencies already installed"
    echo ""
fi

# Start the service
echo "Starting Python service on http://localhost:8000"
echo "API docs available at: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop the service"
echo "=========================================="
echo ""

cd "$PYTHON_SERVICE_DIR"
python3 start_server.py

