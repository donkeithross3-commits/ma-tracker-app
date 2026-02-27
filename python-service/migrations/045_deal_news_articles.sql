-- Store M&A-relevant news articles from Polygon for deal monitoring
CREATE TABLE IF NOT EXISTS deal_news_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker VARCHAR(20) NOT NULL,
    article_id VARCHAR(100),
    title TEXT,
    publisher VARCHAR(100),
    published_at TIMESTAMPTZ,
    article_url TEXT,
    summary TEXT,
    relevance_score FLOAT,
    risk_factor_affected VARCHAR(20),
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (ticker, article_id)
);
CREATE INDEX IF NOT EXISTS idx_dna_ticker ON deal_news_articles (ticker);
CREATE INDEX IF NOT EXISTS idx_dna_published ON deal_news_articles (published_at DESC);
