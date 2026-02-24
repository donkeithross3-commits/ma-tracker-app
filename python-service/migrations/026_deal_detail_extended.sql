-- Add missing fields from production Google Sheet deal detail tabs
-- Fields visible in rows 34-39, 41, 45-46, 56-61, 63-67

ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS revenue_mostly_us TEXT;
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS reputable_acquiror TEXT;
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS target_business_description TEXT;
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS mac_clauses TEXT;
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS closing_conditions TEXT;
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS sellside_pushback TEXT;
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS go_shop_or_overbid TEXT;
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS financing_details TEXT;

-- Probability / risk analysis section (rows 56-61)
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS probability_of_success NUMERIC(6,4);
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS probability_of_higher_offer NUMERIC(6,4);
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS offer_bump_premium NUMERIC(6,4);
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS break_price NUMERIC(12,4);
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS implied_downside NUMERIC(10,4);
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS return_risk_ratio NUMERIC(10,4);

-- Options section (rows 63-67)
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS optionable TEXT;
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS long_naked_calls TEXT;
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS long_vertical_call_spread TEXT;
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS long_covered_call TEXT;
ALTER TABLE sheet_deal_details ADD COLUMN IF NOT EXISTS short_put_vertical_spread TEXT;
