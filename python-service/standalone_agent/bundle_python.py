#!/usr/bin/env python3
"""
Bundle Python for Windows Distribution
======================================
This script prepares a Python embeddable distribution for Windows users
who don't have Python installed. It:

1. Downloads the official Python embeddable package from python.org
2. Configures it to allow pip and site-packages
3. Installs the websockets dependency
4. Creates a ready-to-use bundle in python_bundle/

Run this script on the server to prepare the bundle, which will then
be included in the downloadable ZIP for Windows users.

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

# get-pip.py download URL
GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"


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
    Configure the ._pth file to enable site-packages and pip.
    
    The embeddable distribution has a restrictive ._pth file that prevents
    importing from site-packages. We need to modify it.
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
    
    # Write back
    with open(pth_file, 'w') as f:
        f.writelines(new_lines)
    
    print(f"  -> Enabled site-packages imports")


def install_pip(bundle_dir: Path) -> None:
    """Install pip into the bundled Python."""
    python_exe = bundle_dir / "python.exe"
    get_pip = bundle_dir / "get-pip.py"
    
    # Download get-pip.py
    download_file(GET_PIP_URL, get_pip)
    
    # Run get-pip.py
    print("Installing pip...")
    result = subprocess.run(
        [str(python_exe), str(get_pip), "--no-warn-script-location"],
        cwd=bundle_dir,
        capture_output=True,
        text=True
    )
    
    if result.returncode != 0:
        print(f"ERROR installing pip: {result.stderr}")
        raise RuntimeError("Failed to install pip")
    
    print("  -> pip installed")
    
    # Clean up get-pip.py
    get_pip.unlink()


def install_dependencies(bundle_dir: Path, requirements_file: Path) -> None:
    """Install dependencies from requirements.txt."""
    python_exe = bundle_dir / "python.exe"
    
    print(f"Installing dependencies from {requirements_file.name}...")
    result = subprocess.run(
        [
            str(python_exe), "-m", "pip", "install",
            "--no-warn-script-location",
            "--disable-pip-version-check",
            "-r", str(requirements_file)
        ],
        cwd=bundle_dir,
        capture_output=True,
        text=True
    )
    
    if result.returncode != 0:
        print(f"ERROR installing dependencies: {result.stderr}")
        raise RuntimeError("Failed to install dependencies")
    
    print("  -> Dependencies installed")


def cleanup_bundle(bundle_dir: Path) -> None:
    """Remove unnecessary files to reduce bundle size."""
    print("Cleaning up bundle...")
    
    # Patterns to remove
    patterns_to_remove = [
        "**/__pycache__",
        "**/*.pyc",
        "**/*.pyo",
        "**/pip*",  # Remove pip itself after installing deps
        "**/setuptools*",
        "**/pkg_resources*",
        "**/distutils*",
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
        help="Skip cleanup step (keep pip, etc.)"
    )
    args = parser.parse_args()
    
    script_dir = Path(__file__).parent
    bundle_dir = script_dir / args.output_dir
    requirements_file = script_dir / "requirements.txt"
    
    print("=" * 60)
    print("Python Bundle Creator for IB Data Agent")
    print("=" * 60)
    print(f"Python version: {args.python_version}")
    print(f"Output directory: {bundle_dir}")
    print()
    
    # Check if we're on Windows (required for the embeddable to work)
    if sys.platform != "win32":
        print("NOTE: This script creates a Windows bundle.")
        print("      The bundle will only work on Windows.")
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
    
    # Create Lib/site-packages directory
    site_packages = bundle_dir / "Lib" / "site-packages"
    site_packages.mkdir(parents=True, exist_ok=True)
    
    # Install pip
    install_pip(bundle_dir)
    
    # Install dependencies
    if requirements_file.exists():
        install_dependencies(bundle_dir, requirements_file)
    else:
        print(f"WARNING: {requirements_file} not found, skipping dependency installation")
    
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
    print("Next steps:")
    print("1. The bundle will be included in Windows agent downloads")
    print("2. start_windows.bat will automatically use this bundled Python")
    print()
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
