#!/usr/bin/env python3
"""
KRJ Batch Copy Script - Updated with Metadata Generation

This script copies the latest KRJ signal files from the input directory
to the output directory, removing date suffixes from filenames.

NEW: Also generates metadata.json with the signal date extracted from filenames.

Environment Variables:
  KRJ_DATA_DIR: Input directory (default: /root/Documents/daily_data)
  KRJ_OUTPUT_DIR: Output directory (default: /data/krj)

Input Files:
  KRJ_signals_latest_week_Equities_YYYY-MM-DD.csv
  KRJ_signals_latest_week_ETFs_and_FX_YYYY-MM-DD.csv
  KRJ_signals_latest_week_SP500_YYYY-MM-DD.csv
  KRJ_signals_latest_week_SP100_YYYY-MM-DD.csv

Output Files:
  latest_equities.csv
  latest_etfs_fx.csv
  latest_sp500.csv
  latest_sp100.csv
  metadata.json (NEW)

Usage:
  python run_krj_batch.py
"""

import os
import re
import json
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional

# Configuration from environment variables
KRJ_DATA_DIR = os.getenv('KRJ_DATA_DIR', '/root/Documents/daily_data')
KRJ_OUTPUT_DIR = os.getenv('KRJ_OUTPUT_DIR', '/data/krj')

# Category mappings: (input pattern, output filename)
CATEGORIES = {
    'Equities': 'latest_equities.csv',
    'ETFs_and_FX': 'latest_etfs_fx.csv',
    'SP500': 'latest_sp500.csv',
    'SP100': 'latest_sp100.csv',
    'NDX100': 'latest_ndx100.csv',
}

# Regex to extract date from filename: KRJ_signals_latest_week_{CATEGORY}_{YYYY-MM-DD}.csv
FILENAME_PATTERN = re.compile(r'KRJ_signals_latest_week_(.+?)_(\d{4}-\d{2}-\d{2})\.csv')


def find_latest_file(data_dir: str, category: str) -> Optional[tuple[str, str]]:
    """
    Find the latest file for a given category.
    
    Args:
        data_dir: Directory to search
        category: Category name (e.g., 'Equities', 'ETFs_and_FX')
    
    Returns:
        Tuple of (filepath, date_string) or None if not found
    """
    pattern = f'KRJ_signals_latest_week_{category}_*.csv'
    matching_files = []
    
    for filename in os.listdir(data_dir):
        match = FILENAME_PATTERN.match(filename)
        if match and match.group(1) == category:
            date_str = match.group(2)
            filepath = os.path.join(data_dir, filename)
            matching_files.append((filepath, date_str, filename))
    
    if not matching_files:
        return None
    
    # Sort by date string (lexicographic sort works for YYYY-MM-DD format)
    matching_files.sort(key=lambda x: x[1], reverse=True)
    
    # Return the latest (first after reverse sort)
    latest = matching_files[0]
    return (latest[0], latest[1])


def copy_latest_files() -> Dict[str, str]:
    """
    Copy the latest file for each category to the output directory.
    
    Returns:
        Dictionary mapping category to signal date
    """
    data_dir = Path(KRJ_DATA_DIR)
    output_dir = Path(KRJ_OUTPUT_DIR)
    
    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)
    
    category_dates = {}
    
    for category, output_filename in CATEGORIES.items():
        result = find_latest_file(str(data_dir), category)
        
        if result is None:
            print(f"WARNING: No files found for category '{category}'")
            continue
        
        source_path, signal_date = result
        dest_path = output_dir / output_filename
        
        print(f"Found latest {category} file: {Path(source_path).name}")
        print(f"  Signal date: {signal_date}")
        print(f"  Copying to: {dest_path}")
        
        # Copy the file
        shutil.copy2(source_path, dest_path)
        
        # Store the signal date for this category
        category_dates[category.lower().replace('_and_', '_')] = signal_date
    
    return category_dates


def generate_metadata(category_dates: Dict[str, str]) -> None:
    """
    Generate metadata.json file with signal dates.
    
    Args:
        category_dates: Dictionary mapping category to signal date
    """
    output_dir = Path(KRJ_OUTPUT_DIR)
    metadata_path = output_dir / 'metadata.json'
    
    # Find the most common date (should all be the same for a weekly run)
    dates = list(category_dates.values())
    if not dates:
        print("WARNING: No dates found, skipping metadata generation")
        return
    
    # Use the first date as the primary signal date
    # (In practice, all categories should have the same date)
    signal_date = dates[0]
    
    metadata = {
        'signal_date': signal_date,
        'generated_at': datetime.utcnow().isoformat() + 'Z',
        'categories': category_dates,
        'version': '1.0'
    }
    
    print(f"\nGenerating metadata file: {metadata_path}")
    print(f"  Signal date: {signal_date}")
    
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    print(f"✓ Metadata file created successfully")


def main():
    """Main execution function."""
    print("=" * 60)
    print("KRJ Batch Copy Script")
    print("=" * 60)
    print(f"Input directory:  {KRJ_DATA_DIR}")
    print(f"Output directory: {KRJ_OUTPUT_DIR}")
    print()
    
    # Copy files and collect signal dates
    category_dates = copy_latest_files()
    
    # Generate metadata file
    if category_dates:
        generate_metadata(category_dates)
    
    print()
    print("=" * 60)
    print("Batch copy complete!")
    print("=" * 60)


if __name__ == '__main__':
    main()

