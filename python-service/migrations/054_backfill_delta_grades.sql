-- Backfill grades for delta assessments that stored NULL due to format mismatch.
-- Delta AI responses have grades at top-level ({"vote": {"grade": "Low"}})
-- instead of nested ({"grades": {"vote": {"grade": "Low"}}}).
-- The ai_response JSONB column has the correct data; extract and populate grade columns.

UPDATE deal_risk_assessments
SET
    vote_grade       = ai_response->'vote'->>'grade',
    vote_detail      = ai_response->'vote'->>'detail',
    vote_confidence  = (ai_response->'vote'->>'confidence')::NUMERIC(4,2),
    financing_grade  = ai_response->'financing'->>'grade',
    financing_detail = ai_response->'financing'->>'detail',
    financing_confidence = (ai_response->'financing'->>'confidence')::NUMERIC(4,2),
    legal_grade      = ai_response->'legal'->>'grade',
    legal_detail     = ai_response->'legal'->>'detail',
    legal_confidence = (ai_response->'legal'->>'confidence')::NUMERIC(4,2),
    regulatory_grade = ai_response->'regulatory'->>'grade',
    regulatory_detail = ai_response->'regulatory'->>'detail',
    regulatory_confidence = (ai_response->'regulatory'->>'confidence')::NUMERIC(4,2),
    mac_grade        = ai_response->'mac'->>'grade',
    mac_detail       = ai_response->'mac'->>'detail',
    mac_confidence   = (ai_response->'mac'->>'confidence')::NUMERIC(4,2),
    -- Supplemental scores
    market_score     = COALESCE(market_score, (ai_response->'market'->>'score')::NUMERIC(4,2)),
    market_detail    = COALESCE(market_detail, ai_response->'market'->>'detail'),
    timing_score     = COALESCE(timing_score, (ai_response->'timing'->>'score')::NUMERIC(4,2)),
    timing_detail    = COALESCE(timing_detail, ai_response->'timing'->>'detail'),
    competing_bid_score = COALESCE(competing_bid_score, (ai_response->'competing_bid'->>'score')::NUMERIC(4,2)),
    competing_bid_detail = COALESCE(competing_bid_detail, ai_response->'competing_bid'->>'detail'),
    -- Investable: handle multiple formats (string, bool, object with value/grade key)
    investable_assessment = COALESCE(investable_assessment,
        CASE
            -- Simple boolean
            WHEN jsonb_typeof(ai_response->'investable') = 'boolean'
                THEN CASE WHEN (ai_response->>'investable')::boolean THEN 'Yes' ELSE 'No' END
            -- Simple string
            WHEN jsonb_typeof(ai_response->'investable') = 'string'
                THEN LEFT(ai_response->>'investable', 20)
            -- Object with "value" key (string or boolean)
            WHEN jsonb_typeof(ai_response->'investable') = 'object'
                AND ai_response->'investable' ? 'value'
                THEN CASE
                    WHEN jsonb_typeof(ai_response->'investable'->'value') = 'boolean'
                        THEN CASE WHEN (ai_response->'investable'->>'value')::boolean THEN 'Yes' ELSE 'No' END
                    ELSE LEFT(ai_response->'investable'->>'value', 20)
                END
            -- Object with "grade" key
            WHEN jsonb_typeof(ai_response->'investable') = 'object'
                AND ai_response->'investable' ? 'grade'
                THEN LEFT(ai_response->'investable'->>'grade', 20)
            -- Object with "answer" key
            WHEN jsonb_typeof(ai_response->'investable') = 'object'
                AND ai_response->'investable' ? 'answer'
                THEN LEFT(ai_response->'investable'->>'answer', 20)
            ELSE NULL
        END),
    -- Investable reasoning from object detail
    investable_reasoning = COALESCE(investable_reasoning,
        CASE
            WHEN jsonb_typeof(ai_response->'investable') = 'object'
                THEN ai_response->'investable'->>'detail'
            ELSE NULL
        END),
    -- Deal summary
    deal_summary = COALESCE(deal_summary, ai_response->>'summary')
WHERE
    vote_grade IS NULL
    AND ai_response IS NOT NULL
    AND ai_response->'vote'->>'grade' IS NOT NULL
    AND ai_response->'grades' IS NULL;  -- Only fix flat-format responses
