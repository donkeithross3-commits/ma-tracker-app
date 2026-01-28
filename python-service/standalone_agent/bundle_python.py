#!/usr/bin/env python3
"""
Bundle Python for Windows Distribution
======================================
This script prepares a Python embeddable distribution for Windows users
who don't have Python installed. It:

1. Downloads the official Python embeddable package from python.org
2. Configures it to allow importing from site-packages
3. Downloads and extracts the websockets wheel directly
4. Creates a ready-to-use bundle in python_bundle/

This script can run on Linux (server) to prepare a Windows bundle.
It doesn't execute the Windows Python - just downloads and configures files.

Usage:
    python bundle_python.py [--python-version 3.11.9]
"""

import argparse
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

# Default Python version - 3.11 is well-tested and stable
DEFAULT_PYTHON_VERSION = "3.11.9"

# Python embeddable download URL template
PYTHON_DOWNLOAD_URL = "https://www.python.org/ftp/python/{version}/python-{version}-embed-amd64.zip"

# Direct wheel download URLs (pre-built, no compilation needed)
# We use the wheel format which is just a zip file we can extract
WEBSOCKETS_WHEEL_URL = "https://files.pythonhosted.org/packages/py3/w/websockets/websockets-14.1-py3-none-any.whl"


def download_file(url: str, dest: Path) -> None:
    """Download a file from URL to destination."""
    print(f"Downloading {url}...")
    urllib.request.urlretrieve(url, dest)
    print(f"  -> Saved to {dest}")


def extract_zip(zip_path: Path, dest_dir: Path) -> None:
    """Extract a ZIP file to destination directory."""
    print(f"Extracting {zip_path}...")
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(dest_dir)
    print(f"  -> Extracted to {dest_dir}")


def configure_pth_file(bundle_dir: Path, python_version: str) -> None:
    """
    Configure the ._pth file to enable site-packages and script directory imports.
    
    The embeddable distribution has a restrictive ._pth file that prevents
    importing from site-packages and doesn't include the current directory.
    We need to modify it to allow both.
    """
    # Find the ._pth file (e.g., python311._pth)
    major_minor = python_version.rsplit('.', 1)[0].replace('.', '')  # "3.11.9" -> "311"
    pth_file = bundle_dir / f"python{major_minor}._pth"
    
    if not pth_file.exists():
        # Try alternative naming
        for f in bundle_dir.glob("python*._pth"):
            pth_file = f
            break
    
    if not pth_file.exists():
        print(f"WARNING: Could not find ._pth file in {bundle_dir}")
        return
    
    print(f"Configuring {pth_file.name}...")
    
    # Read current contents
    with open(pth_file, 'r') as f:
        lines = f.readlines()
    
    # Modify to enable imports
    new_lines = []
    for line in lines:
        # Uncomment 'import site' line
        if line.strip() == '#import site':
            new_lines.append('import site\n')
        else:
            new_lines.append(line)
    
    # Add Lib/site-packages if not present
    if 'Lib/site-packages\n' not in new_lines and 'Lib\\site-packages\n' not in new_lines:
        new_lines.append('Lib/site-packages\n')
    
    # Add parent directory (..) so scripts in the agent folder can import each other
    # The bundle is in python_bundle/, scripts are in the parent directory
    if '..\n' not in new_lines:
        new_lines.append('..\n')
    
    # Write back
    with open(pth_file, 'w') as f:
        f.writelines(new_lines)
    
    print(f"  -> Enabled site-packages and script directory imports")


def install_websockets_from_wheel(bundle_dir: Path) -> None:
    """
    Install websockets by downloading and extracting the wheel directly.
    
    A wheel file is just a ZIP file, so we can extract it without
    running pip or the Windows Python.
    """
    site_packages = bundle_dir / "Lib" / "site-packages"
    site_packages.mkdir(parents=True, exist_ok=True)
    
    wheel_path = bundle_dir / "websockets.whl"
    
    # Download the wheel
    download_file(WEBSOCKETS_WHEEL_URL, wheel_path)
    
    # Extract the wheel (it's a ZIP file)
    print("Installing websockets from wheel...")
    with zipfile.ZipFile(wheel_path, 'r') as zf:
        zf.extractall(site_packages)
    
    # Clean up wheel file
    wheel_path.unlink()
    
    print("  -> websockets installed")


def cleanup_bundle(bundle_dir: Path) -> None:
    """Remove unnecessary files to reduce bundle size."""
    print("Cleaning up bundle...")
    
    # Patterns to remove
    patterns_to_remove = [
        "**/__pycache__",
        "**/*.pyc",
        "**/*.pyo",
        "**/*.dist-info",
        "**/*.egg-info",
    ]
    
    removed_count = 0
    for pattern in patterns_to_remove:
        for path in bundle_dir.glob(pattern):
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            removed_count += 1
    
    print(f"  -> Removed {removed_count} unnecessary items")


def get_bundle_size(bundle_dir: Path) -> int:
    """Calculate total size of bundle in bytes."""
    total = 0
    for path in bundle_dir.rglob("*"):
        if path.is_file():
            total += path.stat().st_size
    return total


def main():
    parser = argparse.ArgumentParser(description="Bundle Python for Windows distribution")
    parser.add_argument(
        "--python-version",
        default=DEFAULT_PYTHON_VERSION,
        help=f"Python version to bundle (default: {DEFAULT_PYTHON_VERSION})"
    )
    parser.add_argument(
        "--output-dir",
        default="python_bundle",
        help="Output directory name (default: python_bundle)"
    )
    parser.add_argument(
        "--skip-cleanup",
        action="store_true",
        help="Skip cleanup step"
    )
    args = parser.parse_args()
    
    script_dir = Path(__file__).parent
    bundle_dir = script_dir / args.output_dir
    
    print("=" * 60)
    print("Python Bundle Creator for IB Data Agent")
    print("=" * 60)
    print(f"Python version: {args.python_version}")
    print(f"Output directory: {bundle_dir}")
    print()
    
    print("NOTE: This creates a Windows bundle by downloading and")
    print("      configuring files (no Windows Python execution needed).")
    print()
    
    # Clean existing bundle
    if bundle_dir.exists():
        print(f"Removing existing {args.output_dir}...")
        shutil.rmtree(bundle_dir)
    
    bundle_dir.mkdir(parents=True)
    
    # Download Python embeddable
    download_url = PYTHON_DOWNLOAD_URL.format(version=args.python_version)
    zip_path = bundle_dir / "python_embed.zip"
    
    try:
        download_file(download_url, zip_path)
    except Exception as e:
        print(f"ERROR: Failed to download Python: {e}")
        print(f"URL: {download_url}")
        print("\nTry a different version with --python-version")
        return 1
    
    # Extract to bundle directory
    extract_zip(zip_path, bundle_dir)
    zip_path.unlink()  # Remove the zip file
    
    # Configure ._pth file
    configure_pth_file(bundle_dir, args.python_version)
    
    # Install websockets directly from wheel (no pip needed)
    install_websockets_from_wheel(bundle_dir)
    
    # Cleanup
    if not args.skip_cleanup:
        cleanup_bundle(bundle_dir)
    
    # Calculate final size
    size_bytes = get_bundle_size(bundle_dir)
    size_mb = size_bytes / (1024 * 1024)
    
    print()
    print("=" * 60)
    print("Bundle created successfully!")
    print("=" * 60)
    print(f"Location: {bundle_dir}")
    print(f"Size: {size_mb:.1f} MB")
    print()
    print("Contents:")
    print("  - Python 3.11 embeddable runtime")
    print("  - websockets library (pre-installed)")
    print()
    print("Next steps:")
    print("1. The bundle will be included in Windows agent downloads")
    print("2. start_windows.bat will automatically use this bundled Python")
    print()
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
