-- Add source tracking to news articles (multi-source news intelligence)
ALTER TABLE deal_news_articles
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'polygon';

-- Backfill existing rows
UPDATE deal_news_articles SET source = 'polygon' WHERE source IS NULL;

-- Index for source-based queries
CREATE INDEX IF NOT EXISTS idx_deal_news_source ON deal_news_articles(source);
