"""Pydantic models for EDGAR data structures"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class EdgarRSSItem(BaseModel):
    """Single filing from EDGAR RSS feed"""
    title: str
    link: str
    description: str
    pub_date: datetime
    guid: str


class EdgarFiling(BaseModel):
    """Parsed EDGAR filing"""
    accession_number: str
    cik: str
    company_name: Optional[str] = None
    ticker: Optional[str] = None
    filing_type: str
    filing_date: datetime
    filing_url: str


class MADetectionResult(BaseModel):
    """Result of M&A relevance detection"""
    is_ma_relevant: bool
    confidence_score: float = Field(ge=0.0, le=1.0)
    detected_keywords: List[str]
    reasoning: str


class DealExtraction(BaseModel):
    """Extracted deal information from filing"""
    target_name: str
    target_ticker: Optional[str] = None
    acquirer_name: Optional[str] = None
    acquirer_ticker: Optional[str] = None
    deal_value: Optional[float] = None  # in billions
    deal_type: str  # merger, acquisition, tender_offer, spin_off
    confidence_score: float = Field(ge=0.0, le=1.0)
    key_terms: List[str]
    announcement_summary: str


class AlertPayload(BaseModel):
    """Alert notification payload"""
    staged_deal_id: str
    target_name: str
    acquirer_name: Optional[str] = None
    deal_value: Optional[float] = None
    filing_type: str
    confidence_score: float
    filing_url: str
    detected_at: datetime
