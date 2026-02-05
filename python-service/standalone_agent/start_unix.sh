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

# ============================================
# Check for desktop shortcut (first run) - Mac only
# ============================================
FIRST_RUN_FLAG="$SCRIPT_DIR/.first_run_complete"

if [[ "$OSTYPE" == "darwin"* ]] && [ ! -f "$FIRST_RUN_FLAG" ]; then
    DESKTOP_ALIAS="$HOME/Desktop/IB Data Agent"
    if [ ! -e "$DESKTOP_ALIAS" ] && [ ! -L "$DESKTOP_ALIAS" ]; then
        echo "============================================"
        echo "First Run Setup"
        echo "============================================"
        echo ""
        read -p "Would you like to create a desktop shortcut? (y/n): " CREATE_SHORTCUT
        if [[ "$CREATE_SHORTCUT" =~ ^[Yy]$ ]]; then
            # Create an alias (symbolic link) on Desktop
            ln -s "$SCRIPT_DIR/start_unix.sh" "$DESKTOP_ALIAS"
            if [ -L "$DESKTOP_ALIAS" ]; then
                echo "✅ Desktop shortcut created!"
            else
                echo "Note: Could not create shortcut automatically."
                echo "You can manually drag start_unix.sh to your dock or desktop."
            fi
        fi
        echo ""
    fi
    # Mark first run as complete
    date > "$FIRST_RUN_FLAG"
fi

# ============================================
# Check for updates
# ============================================
check_for_updates() {
    CURRENT_VERSION="0.0.0"
    if [ -f "$SCRIPT_DIR/version.txt" ]; then
        CURRENT_VERSION=$(cat "$SCRIPT_DIR/version.txt" | tr -d '[:space:]')
    fi
    
    echo "Checking for updates... (current: $CURRENT_VERSION)"
    
    # Fetch server version
    SERVER_RESPONSE=$(curl -s --connect-timeout 5 "https://dr3-dashboard.com/api/ma-options/agent-version" 2>/dev/null)
    
    if [ -z "$SERVER_RESPONSE" ]; then
        echo "Could not check for updates (offline or server unavailable)"
        return 1
    fi
    
    # Parse version from JSON using python (available since we checked earlier)
    SERVER_VERSION=$(echo "$SERVER_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null)
    
    if [ -z "$SERVER_VERSION" ]; then
        echo "Could not parse server version"
        return 1
    fi
    
    if [ "$CURRENT_VERSION" != "$SERVER_VERSION" ]; then
        echo ""
        echo "============================================"
        echo "UPDATE AVAILABLE - Installing automatically"
        echo "============================================"
        echo "Current version: $CURRENT_VERSION"
        echo "New version:     $SERVER_VERSION"
        echo ""
        download_update
        # download_update does exec "$0" to restart; only reach here if it failed
        echo ""
    fi
}

download_update() {
    echo ""
    echo "Downloading update..."
    
    # Create temp directory
    TEMP_DIR=$(mktemp -d)
    ZIP_PATH="$TEMP_DIR/ib-data-agent-update.zip"
    
    # Download (update endpoint uses API key; preserves config.env on extract)
    UPDATE_URL="https://dr3-dashboard.com/api/ma-options/download-agent-update?key=${IB_PROVIDER_KEY}"
    curl -s -o "$ZIP_PATH" "$UPDATE_URL"
    
    if [ ! -f "$ZIP_PATH" ]; then
        echo "ERROR: Failed to download update"
        rm -rf "$TEMP_DIR"
        return 1
    fi
    
    echo "Download complete. Installing update..."
    
    # Backup config.env
    cp "$SCRIPT_DIR/config.env" "$TEMP_DIR/config.env.backup" 2>/dev/null
    
    # Extract
    unzip -q -o "$ZIP_PATH" -d "$TEMP_DIR/extracted"
    
    # Find extracted contents (handle nested folder if present)
    EXTRACT_SRC="$TEMP_DIR/extracted"
    if [ -d "$TEMP_DIR/extracted/ib-data-agent" ]; then
        EXTRACT_SRC="$TEMP_DIR/extracted/ib-data-agent"
    fi
    
    # Copy files (but not config.env)
    for file in "$EXTRACT_SRC"/*; do
        filename=$(basename "$file")
        if [ "$filename" != "config.env" ]; then
            cp -r "$file" "$SCRIPT_DIR/"
        fi
    done
    
    # Restore config.env
    cp "$TEMP_DIR/config.env.backup" "$SCRIPT_DIR/config.env" 2>/dev/null
    
    # Make scripts executable
    chmod +x "$SCRIPT_DIR/start_unix.sh" 2>/dev/null
    
    # Cleanup
    rm -rf "$TEMP_DIR"
    
    echo "✅ Update installed successfully!"
    echo ""
    echo "Restarting with new version..."
    echo ""
    exec "$0"
}

check_for_updates

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

# Run the agent (exec so Ctrl+C goes to agent only, no shell prompt)
exec python3 "$SCRIPT_DIR/ib_data_agent.py"
