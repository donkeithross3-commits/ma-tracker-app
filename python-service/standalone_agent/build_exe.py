#!/usr/bin/env python3
"""
IB Data Agent - Windows Executable Builder
==========================================
Uses PyInstaller to create a standalone .exe that includes Python runtime.
Run this on a Windows machine to generate the executable.

Requirements:
    pip install pyinstaller

Usage:
    python build_exe.py

Output:
    dist/ib_data_agent.exe (~15-20MB)
"""

import subprocess
import sys
import os
import shutil

def check_pyinstaller():
    """Check if PyInstaller is installed"""
    try:
        import PyInstaller
        print(f"✅ PyInstaller {PyInstaller.__version__} found")
        return True
    except ImportError:
        print("❌ PyInstaller not found")
        print("   Install with: pip install pyinstaller")
        return False

def build_exe():
    """Build the executable using PyInstaller"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    main_script = os.path.join(script_dir, "ib_data_agent.py")
    ibapi_dir = os.path.join(script_dir, "ibapi")
    ib_scanner = os.path.join(script_dir, "ib_scanner.py")
    
    # Verify required files exist
    if not os.path.exists(main_script):
        print(f"❌ Main script not found: {main_script}")
        return False
    
    if not os.path.exists(ibapi_dir):
        print(f"❌ ibapi directory not found: {ibapi_dir}")
        return False
    
    if not os.path.exists(ib_scanner):
        print(f"❌ ib_scanner.py not found: {ib_scanner}")
        return False
    
    print("Building executable...")
    print(f"  Main script: {main_script}")
    print(f"  ibapi dir: {ibapi_dir}")
    print()
    
    # PyInstaller command
    # --onefile: Single executable
    # --console: Show console window (needed for agent output)
    # --name: Output filename
    # --add-data: Include ibapi and ib_scanner
    # --hidden-import: Ensure all ibapi modules are included
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--console",
        "--name", "ib_data_agent",
        "--add-data", f"{ibapi_dir}{os.pathsep}ibapi",
        "--add-data", f"{ib_scanner}{os.pathsep}.",
        # Hidden imports for ibapi
        "--hidden-import", "ibapi.client",
        "--hidden-import", "ibapi.wrapper",
        "--hidden-import", "ibapi.contract",
        "--hidden-import", "ibapi.order",
        "--hidden-import", "ibapi.common",
        "--hidden-import", "ibapi.ticktype",
        "--hidden-import", "ibapi.order_condition",
        "--hidden-import", "ibapi.softdollartier",
        "--hidden-import", "ibapi.execution",
        "--hidden-import", "ibapi.commission_report",
        "--hidden-import", "ibapi.scanner",
        "--hidden-import", "ibapi.tag_value",
        "--hidden-import", "ibapi.account_summary_tags",
        # Hidden imports for websockets
        "--hidden-import", "websockets",
        "--hidden-import", "websockets.client",
        "--hidden-import", "websockets.exceptions",
        # Clean build
        "--clean",
        "--noconfirm",
        # Work directory
        "--workpath", os.path.join(script_dir, "build"),
        "--distpath", os.path.join(script_dir, "dist"),
        "--specpath", script_dir,
        # Main script
        main_script,
    ]
    
    print("Running PyInstaller...")
    print(f"  Command: {' '.join(cmd)}")
    print()
    
    try:
        result = subprocess.run(cmd, cwd=script_dir, check=True)
        print()
        print("=" * 50)
        print("✅ Build successful!")
        print("=" * 50)
        
        exe_path = os.path.join(script_dir, "dist", "ib_data_agent.exe")
        if os.path.exists(exe_path):
            size_mb = os.path.getsize(exe_path) / (1024 * 1024)
            print(f"   Output: {exe_path}")
            print(f"   Size: {size_mb:.1f} MB")
        
        print()
        print("Next steps:")
        print("1. Test the executable on a Windows machine without Python")
        print("2. Copy ib_data_agent.exe to the standalone_agent directory")
        print("3. The download endpoint will automatically include it")
        
        return True
        
    except subprocess.CalledProcessError as e:
        print(f"❌ Build failed with exit code {e.returncode}")
        return False
    except FileNotFoundError:
        print("❌ PyInstaller command not found")
        print("   Make sure PyInstaller is installed: pip install pyinstaller")
        return False

def clean_build():
    """Remove build artifacts"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    dirs_to_remove = [
        os.path.join(script_dir, "build"),
        os.path.join(script_dir, "__pycache__"),
    ]
    
    files_to_remove = [
        os.path.join(script_dir, "ib_data_agent.spec"),
    ]
    
    for d in dirs_to_remove:
        if os.path.exists(d):
            print(f"Removing {d}")
            shutil.rmtree(d)
    
    for f in files_to_remove:
        if os.path.exists(f):
            print(f"Removing {f}")
            os.remove(f)

def main():
    print("=" * 50)
    print("IB Data Agent - Executable Builder")
    print("=" * 50)
    print()
    
    # Check platform
    if sys.platform != "win32":
        print("⚠️  Warning: Building on non-Windows platform")
        print("   The resulting exe will only work on Windows")
        print("   For best results, build on a Windows machine")
        print()
    
    # Check PyInstaller
    if not check_pyinstaller():
        print()
        print("Install PyInstaller and try again:")
        print("  pip install pyinstaller")
        sys.exit(1)
    
    print()
    
    # Build
    if build_exe():
        # Clean up build artifacts (but keep dist/)
        print()
        print("Cleaning up build artifacts...")
        clean_build()
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
