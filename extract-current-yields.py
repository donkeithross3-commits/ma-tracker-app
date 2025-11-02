#!/usr/bin/env python3
"""
Extract current yield values from individual deal sheets in the Excel file.
Outputs JSON that can be used to update the seed script.
"""

import openpyxl
import json

# Load the workbook
wb = openpyxl.load_workbook('/Users/donaldross/Downloads/M&A Model Tracker (1).xlsx', data_only=True)

# Get all sheet names (excluding the Dashboard)
all_sheets = wb.sheetnames
deal_sheets = [s for s in all_sheets if s != 'Dashboard']

print(f"Found {len(deal_sheets)} deal sheets")

# Extract current yield (C19) from each deal sheet
current_yields = {}

for sheet_name in deal_sheets:
    sheet = wb[sheet_name]

    # Get ticker from C2
    ticker = sheet['C2'].value

    # Get current yield from C19 (Expected IRR)
    current_yield_value = sheet['C19'].value

    if ticker and current_yield_value is not None:
        # Only process if it's a number (not datetime or string)
        if isinstance(current_yield_value, (int, float)):
            current_yields[ticker] = float(current_yield_value)
            print(f"{ticker}: {current_yield_value:.6f} ({current_yield_value * 100:.2f}%)")
        else:
            print(f"{ticker}: Skipped (C19 contains {type(current_yield_value).__name__}: {current_yield_value})")

# Output as JSON for easy copying into TypeScript
print("\n\nJSON Output:")
print(json.dumps(current_yields, indent=2))

wb.close()
