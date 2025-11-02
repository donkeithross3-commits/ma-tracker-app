#!/usr/bin/env python3
"""
Extract all active deals from the Dashboard sheet with complete data.
"""

import openpyxl
import json

# Load the workbook
wb = openpyxl.load_workbook('/Users/donaldross/Downloads/M&A Model Tracker (1).xlsx', data_only=True)
dashboard = wb['M&A Dashboard']

deals = []

# Start from row 2 (after header)
row = 2
while True:
    ticker = dashboard[f'A{row}'].value

    # Stop when we hit an empty ticker
    if not ticker or ticker in ['Exited Position', 'Template']:
        row += 1
        if row > 100:  # Safety limit
            break
        continue

    # Extract all columns from the dashboard
    deal = {
        'ticker': ticker,
        'acquiror': dashboard[f'B{row}'].value,
        'announced': dashboard[f'C{row}'].value,
        'close_date': dashboard[f'D{row}'].value,
        'outside_date': dashboard[f'E{row}'].value,
        'deal_px': dashboard[f'G{row}'].value,
        'current_px': dashboard[f'H{row}'].value,
        'category': dashboard[f'L{row}'].value,
        'investable': dashboard[f'M{row}'].value,
        'deal_notes': dashboard[f'N{row}'].value,
        'vote_risk': dashboard[f'O{row}'].value,
        'finance_risk': dashboard[f'P{row}'].value,
        'legal_risk': dashboard[f'Q{row}'].value,
        'has_cvr': dashboard[f'R{row}'].value == 'Yes',
    }

    deals.append(deal)
    row += 1

    if row > 100:  # Safety limit
        break

print(f"Found {len(deals)} deals\n")

# Format dates
for deal in deals:
    for field in ['announced', 'close_date', 'outside_date']:
        if deal[field] and hasattr(deal[field], 'strftime'):
            deal[field] = deal[field].strftime('%Y-%m-%d')
        elif not deal[field]:
            deal[field] = None

# Output as JSON
print(json.dumps(deals, indent=2, default=str))

wb.close()
