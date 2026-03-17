"""
Historical M&A Research Database

A 10-year institutional-grade historical database of U.S.-listed acquisition deals,
integrated with the live deal-monitoring platform at dr3-dashboard.com.

Modules:
    universe/    - Deal discovery from SEC EDGAR (master index + EFTS)
    extraction/  - LLM-powered clause and event extraction from filings
    market_data/ - Polygon stock and options data ingestion
    features/    - Feature engineering for ML models
    analysis/    - Statistical analysis, ML models, and study execution
    qa/          - Data quality checks and human review management
"""
