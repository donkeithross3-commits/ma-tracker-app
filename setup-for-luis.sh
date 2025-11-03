#!/bin/bash

echo "=========================================="
echo "M&A Options Scanner - Quick Setup"
echo "=========================================="
echo ""

# Detect OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     MACHINE=Linux;;
    Darwin*)    MACHINE=Mac;;
    CYGWIN*)    MACHINE=Windows;;
    MINGW*)     MACHINE=Windows;;
    *)          MACHINE="UNKNOWN:${OS}"
esac

echo "Detected OS: $MACHINE"
echo ""

# Check prerequisites
echo "🔍 Checking prerequisites..."
echo ""

# Check for Python3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed"
    echo ""
    if [ "$MACHINE" = "Mac" ]; then
        echo "Install Python 3.11 from: https://www.python.org/downloads/"
        echo "Or use Homebrew: brew install python@3.11"
    elif [ "$MACHINE" = "Linux" ]; then
        echo "Install Python 3: sudo apt-get install python3 python3-pip"
    elif [ "$MACHINE" = "Windows" ]; then
        echo "Install Python 3.11 from: https://www.python.org/downloads/"
        echo "⚠️  Choose Python 3.11.x (NOT 3.14 or newer)"
    fi
    exit 1
fi

# Check Python version compatibility
PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
PYTHON_MAJOR=$(python3 -c 'import sys; print(sys.version_info[0])')
PYTHON_MINOR=$(python3 -c 'import sys; print(sys.version_info[1])')

echo "✅ Python found: $PYTHON_VERSION"

# Check if version is compatible (3.9+)
if [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -ge 9 ] && [ "$PYTHON_MINOR" -le 12 ]; then
    echo "✅ Python version is compatible"
elif [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -ge 13 ]; then
    echo "⚠️  Python $PYTHON_VERSION detected (newer than recommended)"
    echo "   Recommended: Python 3.11-3.12, but will try to proceed..."
elif [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 9 ]; then
    echo "❌ Python $PYTHON_VERSION is too old (need 3.9 or newer)"
    exit 1
else
    echo "❌ Unsupported Python version: $PYTHON_VERSION"
    exit 1
fi

# Check for pip (try pip3 first, then pip, then python -m pip)
if command -v pip3 &> /dev/null; then
    echo "✅ pip3 found"
    PIP_CMD="pip3"
elif command -v pip &> /dev/null; then
    echo "✅ pip found"
    PIP_CMD="pip"
elif python -m pip --version &> /dev/null; then
    echo "✅ pip found (via python -m pip)"
    PIP_CMD="python -m pip"
else
    echo "❌ pip is not installed"
    echo "Please reinstall Python and ensure pip is included"
    exit 1
fi

echo ""

# Step 1: Install Python dependencies
echo "📦 Step 1/4: Installing Python dependencies..."
cd "$(dirname "$0")/python-service" || exit
$PIP_CMD install -q -r requirements.txt
if [ $? -eq 0 ]; then
    echo "✅ Python dependencies installed"
else
    echo "❌ Failed to install Python dependencies"
    echo "Try manually:"
    echo "  cd ~/ma-tracker-app/python-service"
    echo "  python -m pip install -r requirements.txt"
    exit 1
fi
echo ""

# Step 2: Install ngrok
echo "🌐 Step 2/4: Installing ngrok..."
cd "$(dirname "$0")" || exit

if command -v ngrok &> /dev/null; then
    echo "✅ ngrok already installed"
else
    # Download ngrok based on OS
    if [ "$MACHINE" = "Mac" ]; then
        echo "Downloading ngrok for Mac..."
        curl -sL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-amd64.zip -o ngrok.zip
    elif [ "$MACHINE" = "Linux" ]; then
        echo "Downloading ngrok for Linux..."
        curl -sL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.zip -o ngrok.zip
    else
        echo "⚠️  Please download ngrok manually from: https://ngrok.com/download"
        exit 1
    fi

    unzip -q ngrok.zip
    chmod +x ngrok
    mkdir -p ~/bin
    mv ngrok ~/bin/
    rm -f ngrok.zip

    # Add to PATH for current session
    export PATH="$HOME/bin:$PATH"

    echo "✅ ngrok installed to ~/bin/ngrok"
fi
echo ""

# Step 3: Create startup script
echo "📝 Step 3/4: Creating startup script..."

cat > ~/start-scanner.sh << 'STARTSCRIPT'
#!/bin/bash

echo "Starting M&A Options Scanner..."
echo ""

# Find the repository directory
REPO_DIR="$HOME/ma-tracker-app"
if [ ! -d "$REPO_DIR" ]; then
    REPO_DIR="$HOME/Documents/ma-tracker-app"
fi
if [ ! -d "$REPO_DIR" ]; then
    echo "❌ Cannot find ma-tracker-app directory"
    echo "Please update REPO_DIR in ~/start-scanner.sh"
    exit 1
fi

# Start Python service
echo "🐍 Starting Python service..."
cd "$REPO_DIR/python-service"
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/scanner.log 2>&1 &
PYTHON_PID=$!
echo "✅ Python service started (PID: $PYTHON_PID)"

# Wait for Python service to start
sleep 3

# Check if Python service is running
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "✅ Python service is healthy"
else
    echo "⚠️  Python service may not be running correctly"
    echo "Check logs: tail -f /tmp/scanner.log"
fi

# Check if ngrok is authenticated (try multiple common locations)
NGROK_AUTHENTICATED=false

# Mac/Linux locations
if [ -f ~/.ngrok2/ngrok.yml ] || [ -f ~/Library/Application\ Support/ngrok/ngrok.yml ]; then
    NGROK_AUTHENTICATED=true
fi

# Windows standard location
if [ -f "$HOME/AppData/Local/ngrok/ngrok.yml" ]; then
    NGROK_AUTHENTICATED=true
fi

# Windows Store version (check in Packages folder)
if find "$HOME/AppData/Local/Packages" -path "*/ngrok*/ngrok.yml" 2>/dev/null | grep -q .; then
    NGROK_AUTHENTICATED=true
fi

if [ "$NGROK_AUTHENTICATED" = false ]; then
    echo ""
    echo "⚠️  ngrok is not authenticated yet!"
    echo ""
    echo "Please do this once:"
    echo "1. Sign up free at: https://dashboard.ngrok.com/signup"
    echo "2. Get your authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken"
    echo "3. Run: ngrok config add-authtoken YOUR_TOKEN_HERE"
    echo ""
    echo "Then run this script again: ~/start-scanner.sh"
    exit 0
fi

# Start ngrok tunnel
echo "🌐 Starting ngrok tunnel..."
ngrok http 8000 > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!
echo "✅ ngrok started (PID: $NGROK_PID)"

# Wait for ngrok to start
sleep 3

# Get ngrok URL
echo ""
echo "🔍 Getting your public URL..."
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | python3 -c "import sys, json; print(json.load(sys.stdin)['tunnels'][0]['public_url'])" 2>/dev/null)

if [ -z "$NGROK_URL" ]; then
    echo "⚠️  Could not get ngrok URL automatically"
    echo "Open http://localhost:4040 in your browser to see it"
else
    echo ""
    echo "=========================================="
    echo "✅ SUCCESS! Scanner is running!"
    echo "=========================================="
    echo ""
    echo "Your public URL:"
    echo "  $NGROK_URL"
    echo ""
    echo "Share this URL with your team to update Vercel!"
    echo ""
    echo "To check status:"
    echo "  curl http://localhost:8000/health"
    echo "  curl $NGROK_URL/health"
    echo ""
    echo "To view logs:"
    echo "  tail -f /tmp/scanner.log"
    echo "  tail -f /tmp/ngrok.log"
    echo ""
    echo "To stop:"
    echo "  kill $PYTHON_PID $NGROK_PID"
    echo ""
    echo "Keep this terminal open!"
    echo "Press Ctrl+C to stop the scanner"
    echo "=========================================="
fi

# Keep script running
wait
STARTSCRIPT

chmod +x ~/start-scanner.sh
echo "✅ Startup script created at ~/start-scanner.sh"
echo ""

# Step 4: Instructions
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps for Luis:"
echo ""
echo "1️⃣  Start IB Gateway/TWS and configure API:"
echo "   - Settings → API → Settings"
echo "   - Enable 'Enable ActiveX and Socket Clients'"
echo "   - Port: 7497 (paper) or 7496 (live)"
echo "   - Trusted IPs: Add 127.0.0.1"
echo ""
echo "2️⃣  Get ngrok auth token (one time only):"
echo "   - Sign up free: https://dashboard.ngrok.com/signup"
echo "   - Get token: https://dashboard.ngrok.com/get-started/your-authtoken"
echo "   - Run: ngrok config add-authtoken YOUR_TOKEN"
echo ""
echo "3️⃣  Start the scanner:"
echo "   ~/start-scanner.sh"
echo ""
echo "That's it! The script will:"
echo "  ✅ Start Python service"
echo "  ✅ Start ngrok tunnel"
echo "  ✅ Show your public URL"
echo ""
echo "Total time: ~5 minutes"
echo "=========================================="
