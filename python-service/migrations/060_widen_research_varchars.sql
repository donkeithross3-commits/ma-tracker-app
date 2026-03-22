-- Widen VARCHAR(30) columns that receive AI-extracted data
-- Claude sometimes returns values longer than 30 chars for these fields
-- (e.g., acquirer_type = "private_equity_consortium", deal_structure = "cash_and_stock_with_cvr")

ALTER TABLE research_deals
    ALTER COLUMN deal_key TYPE VARCHAR(50),
    ALTER COLUMN acquirer_type TYPE VARCHAR(50),
    ALTER COLUMN deal_type TYPE VARCHAR(50),
    ALTER COLUMN deal_structure TYPE VARCHAR(50);

-- Also widen clause extraction fields that could overflow
ALTER TABLE research_deal_clauses
    ALTER COLUMN fiduciary_out_type TYPE VARCHAR(50),
    ALTER COLUMN match_right_type TYPE VARCHAR(50),
    ALTER COLUMN extraction_method TYPE VARCHAR(50);
