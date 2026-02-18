#!/usr/bin/env python3
"""
IB Data Agent - Cross-Platform Installer
=========================================
Verifies Python version and installs required dependencies.
"""

import subprocess
import sys
import os

def print_header():
    print("=" * 50)
    print("IB Data Agent - Installer")
    print("=" * 50)
    print()

def check_python_version():
    """Require Python 3.9-3.12"""
    v = sys.version_info
    print(f"Checking Python version... {v.major}.{v.minor}.{v.micro}")
    
    if v.major != 3:
        print(f"❌ Python 3 required, found Python {v.major}")
        return False
    
    if v.minor < 9:
        print(f"❌ Python {v.major}.{v.minor} is too old (need 3.9 or newer)")
        print("   Download Python 3.11 from: https://www.python.org/downloads/")
        return False
    
    if v.minor > 12:
        print(f"⚠️  Python {v.major}.{v.minor} is newer than tested versions")
        print("   Recommended: Python 3.9, 3.10, 3.11, or 3.12")
        print("   Will try to proceed anyway...")
    else:
        print(f"✅ Python {v.major}.{v.minor} is compatible")
    
    return True

def check_pip():
    """Check if pip is available"""
    print("\nChecking pip...")
    try:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "--version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        print("✅ pip is available")
        return True
    except subprocess.CalledProcessError:
        print("❌ pip is not available")
        print("   Please reinstall Python and ensure pip is included")
        return False

def install_websockets():
    """Install websockets package"""
    print("\nInstalling websockets...")
    try:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "-q", "websockets>=11.0"],
            stdout=subprocess.DEVNULL
        )
        print("✅ websockets installed")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to install websockets: {e}")
        print("   Try manually: pip install websockets")
        return False

def verify_ibapi():
    """Verify bundled ibapi is importable"""
    print("\nVerifying bundled ibapi...")
    try:
        # Add current directory to path for local ibapi
        script_dir = os.path.dirname(os.path.abspath(__file__))
        if script_dir not in sys.path:
            sys.path.insert(0, script_dir)
        
        from ibapi.client import EClient
        from ibapi.wrapper import EWrapper
        print("✅ ibapi is available")
        return True
    except ImportError as e:
        print(f"❌ ibapi not found: {e}")
        print("   The ibapi folder should be in the same directory as this script")
        return False

def verify_ib_scanner():
    """Verify ib_scanner.py is importable"""
    print("\nVerifying ib_scanner...")
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        if script_dir not in sys.path:
            sys.path.insert(0, script_dir)
        
        from ib_scanner import IBMergerArbScanner
        print("✅ ib_scanner is available")
        return True
    except ImportError as e:
        print(f"❌ ib_scanner not found: {e}")
        print("   Make sure ib_scanner.py is in the same directory")
        return False

def create_config_if_needed():
    """Create config.env from template if it doesn't exist"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.env")
    template_path = os.path.join(script_dir, "config.env.template")
    
    if os.path.exists(config_path):
        print("\n✅ config.env already exists")
        return
    
    if os.path.exists(template_path):
        print("\nCreating config.env from template...")
        with open(template_path, 'r') as f:
            content = f.read()
        with open(config_path, 'w') as f:
            f.write(content)
        print("✅ config.env created - please edit it with your API key")
    else:
        print("\n⚠️  config.env.template not found")
        print("   You'll need to create config.env manually with:")
        print("   IB_PROVIDER_KEY=your-api-key-here")

def print_success():
    print()
    print("=" * 50)
    print("✅ Installation complete!")
    print("=" * 50)
    print()
    print("Next steps:")
    print()
    print("1. Edit config.env with your API key")
    print("   (Get your key from the MA Tracker web app)")
    print()
    print("2. Start IB TWS or IB Gateway")
    print("   - Enable API: File → Global Configuration → API → Settings")
    print("   - Check 'Enable ActiveX and Socket Clients'")
    print("   - Set Socket Port to 7497 (paper) or 7496 (live) — agent tries both if needed")
    print()
    print("3. Run the agent:")
    if sys.platform == "win32":
        print("   Double-click start_windows.bat")
        print("   Or run: python ib_data_agent.py")
    else:
        print("   ./start_unix.sh")
        print("   Or run: python3 ib_data_agent.py")
    print()

def main():
    print_header()
    
    # Check Python version
    if not check_python_version():
        sys.exit(1)
    
    # Check pip
    if not check_pip():
        sys.exit(1)
    
    # Install websockets
    if not install_websockets():
        sys.exit(1)
    
    # Verify ibapi
    if not verify_ibapi():
        sys.exit(1)
    
    # Verify ib_scanner
    if not verify_ib_scanner():
        sys.exit(1)
    
    # Create config if needed
    create_config_if_needed()
    
    # Success
    print_success()

if __name__ == "__main__":
    main()
