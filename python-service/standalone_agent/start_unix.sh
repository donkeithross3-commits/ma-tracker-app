#!/bin/bash
# IB Data Agent - Mac/Linux Starter
# ==================================

echo "============================================"
echo "IB Data Agent"
echo "============================================"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 not found"
    echo ""
    echo "Please install Python 3.9 or newer:"
    echo ""
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "  Mac: brew install python@3.11"
        echo "  Or download from: https://www.python.org/downloads/"
    else
        echo "  Linux: sudo apt-get install python3 python3-pip"
        echo "  Or download from: https://www.python.org/downloads/"
    fi
    exit 1
fi

# Check Python version
PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PYTHON_MAJOR=$(python3 -c "import sys; print(sys.version_info.major)")
PYTHON_MINOR=$(python3 -c "import sys; print(sys.version_info.minor)")

if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 9 ]); then
    echo "ERROR: Python 3.9 or newer is required"
    echo "Found: Python $PYTHON_VERSION"
    exit 1
fi

echo "✅ Python $PYTHON_VERSION detected"

# Load config.env if it exists
CONFIG_FILE="$SCRIPT_DIR/config.env"
if [ -f "$CONFIG_FILE" ]; then
    echo "Loading config.env..."
    # Export variables, skipping comments and empty lines
    set -a
    source <(grep -v '^#' "$CONFIG_FILE" | grep -v '^$')
    set +a
    echo ""
else
    echo "ERROR: config.env not found"
    echo "Please re-download the agent from the MA Tracker web app."
    exit 1
fi

# Check if API key is set
if [ -z "$IB_PROVIDER_KEY" ] || [ "$IB_PROVIDER_KEY" = "your-api-key-here" ]; then
    echo "ERROR: API key not configured"
    echo ""
    echo "Please re-download the agent from the MA Tracker web app"
    echo "to get a pre-configured version with your API key."
    exit 1
fi

# Set defaults if not configured
: ${IB_HOST:="127.0.0.1"}
: ${IB_PORT:="7497"}
: ${RELAY_URL:="wss://dr3-dashboard.com/ws/data-provider"}

export IB_HOST IB_PORT RELAY_URL IB_PROVIDER_KEY

echo "IB TWS:    $IB_HOST:$IB_PORT"
echo "Relay URL: $RELAY_URL"
echo ""

# Check and install dependencies
echo "Checking dependencies..."
if ! python3 -c "import websockets" 2>/dev/null; then
    echo "Installing required packages..."
    python3 -m pip install --quiet websockets>=11.0
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to install dependencies"
        echo "Try running: python3 -m pip install websockets"
        exit 1
    fi
    echo "Dependencies installed."
else
    echo "Dependencies OK."
fi
echo ""

echo "Starting IB Data Agent..."
echo "Press Ctrl+C to stop"
echo "============================================"
echo ""

# Run the agent
python3 "$SCRIPT_DIR/ib_data_agent.py"

echo ""
echo "Agent stopped."
