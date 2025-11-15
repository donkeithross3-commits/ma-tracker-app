# Feature Development Mode

You are in **FEATURE DEVELOPMENT MODE** for the M&A Intelligence Tracker project.

## Your Mission

Build new features systematically using test-first development with maximum confidence.

## Test-First Development Workflow

### 1. Understand the Feature Request

**Ask clarifying questions:**
- What is the user goal?
- What are the success criteria?
- Are there edge cases to handle?
- What's the expected user experience?
- Any performance requirements?

**Document the feature:**
```markdown
## Feature: [Name]

**User Story:** As a [user type], I want [feature] so that [benefit]

**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

**Technical Notes:**
- Database changes needed?
- New API endpoints?
- Frontend components?
- Background processing?
```

### 2. Design the Solution

**Break down into components:**

**For Backend Features:**
- Database schema changes (if needed)
- Data models (Pydantic)
- API routes
- Business logic
- Background tasks (if needed)

**For Frontend Features:**
- UI components
- API integration
- State management
- User interactions

**For Full-Stack Features:**
- Start with backend (API + database)
- Then add frontend (UI)

### 3. Write Tests FIRST

**Backend Test Example** (`python-service/tests/test_new_feature.py`):
```python
import pytest
from app.api.your_route import your_function

def test_feature_happy_path():
    """Test the main successful flow"""
    # Arrange
    input_data = {...}

    # Act
    result = your_function(input_data)

    # Assert
    assert result['success'] == True
    assert result['data'] == expected_data

def test_feature_edge_case():
    """Test edge cases and error handling"""
    # Arrange
    invalid_input = {...}

    # Act & Assert
    with pytest.raises(ValueError):
        your_function(invalid_input)

def test_feature_database_integration():
    """Test database operations"""
    # Arrange - set up test data

    # Act - perform operation

    # Assert - verify database state
```

**Run the tests (should FAIL initially):**
```bash
cd python-service
pytest tests/test_new_feature.py -v
```

### 4. Implement Database Changes (if needed)

**Create migration:**
```bash
# Next migration number
ls python-service/migrations/ | sort | tail -1
# Create new migration: 01X_feature_name.sql
```

**Migration Template:**
```sql
-- Migration 01X: Feature Name
-- Description of what this migration does

-- Create tables
CREATE TABLE IF NOT EXISTS new_table (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field1 VARCHAR(255) NOT NULL,
    field2 JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_new_table_field1 ON new_table(field1);

-- Add foreign keys if needed
ALTER TABLE existing_table
    ADD COLUMN new_field_id UUID REFERENCES new_table(id);
```

**Apply migration:**
```python
# Test migration
ANTHROPIC_API_KEY="your-key" DATABASE_URL="your-db-url" \
python3 -c "
import asyncio
import asyncpg

async def apply_migration():
    conn = await asyncpg.connect('your-db-url')
    with open('migrations/01X_feature.sql', 'r') as f:
        sql = f.read()
    await conn.execute(sql)
    print('Migration applied!')
    await conn.close()

asyncio.run(apply_migration())
"
```

### 5. Implement the Feature

**Follow this order:**

**A. Data Models** (`python-service/app/models/`):
```python
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

class FeatureRequest(BaseModel):
    """Request model for feature"""
    field1: str = Field(..., description="Description")
    field2: Optional[int] = Field(None, ge=0)

class FeatureResponse(BaseModel):
    """Response model for feature"""
    success: bool
    data: dict
    message: Optional[str]
```

**B. Business Logic** (in appropriate module):
```python
async def process_feature(input: FeatureRequest) -> FeatureResponse:
    """
    Process the feature request

    Args:
        input: Feature request data

    Returns:
        FeatureResponse with results

    Raises:
        ValueError: If input is invalid
    """
    # Validate input
    if not input.field1:
        raise ValueError("field1 is required")

    # Process logic
    try:
        result = await perform_operation(input)
        return FeatureResponse(
            success=True,
            data=result
        )
    except Exception as e:
        logger.error(f"Feature processing failed: {e}", exc_info=True)
        raise
```

**C. API Routes** (`python-service/app/api/feature_routes.py`):
```python
from fastapi import APIRouter, HTTPException
from app.models.feature import FeatureRequest, FeatureResponse
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/feature", tags=["feature"])

@router.post("/process", response_model=FeatureResponse)
async def process_feature_endpoint(request: FeatureRequest):
    """
    Process feature request

    - **field1**: Description
    - **field2**: Description
    """
    try:
        result = await process_feature(request)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error processing feature: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal error")
```

**D. Register Routes** (`python-service/app/main.py`):
```python
from .api.feature_routes import router as feature_router

app.include_router(feature_router)
```

### 6. Verify Tests Pass

```bash
# Run new feature tests
pytest tests/test_new_feature.py -v

# Run all tests
pytest

# Start service
python3 start_server.py

# Test endpoint manually
curl -X POST http://localhost:8000/feature/process \
  -H "Content-Type: application/json" \
  -d '{"field1": "test", "field2": 123}'
```

### 7. Add Frontend (if needed)

**A. Create API Client** (`lib/api.ts`):
```typescript
export async function processFeature(data: FeatureRequest): Promise<FeatureResponse> {
  const response = await fetch('http://localhost:8000/feature/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`)
  }

  return response.json()
}
```

**B. Create Component** (`components/FeatureComponent.tsx`):
```typescript
'use client'  // Only if needed (state/effects)

import { useState } from 'react'

export default function FeatureComponent() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleProcess = async () => {
    setLoading(true)
    try {
      const result = await processFeature({ field1: 'value' })
      setData(result)
    } catch (error) {
      console.error('Feature error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button onClick={handleProcess} disabled={loading}>
        Process Feature
      </button>
      {data && <div>{JSON.stringify(data)}</div>}
    </div>
  )
}
```

**C. Add to Page** (`app/feature/page.tsx`):
```typescript
import FeatureComponent from '@/components/FeatureComponent'

export default function FeaturePage() {
  return (
    <div>
      <h1>Feature Name</h1>
      <FeatureComponent />
    </div>
  )
}
```

### 8. Integration Testing

**Test the complete flow:**
1. Backend endpoint works: `curl http://localhost:8000/feature/process`
2. Frontend loads: `http://localhost:3000/feature`
3. UI interacts correctly with backend
4. Error handling works
5. Edge cases are handled

### 9. Feature Checklist

Before committing:

- [ ] Tests written BEFORE implementation
- [ ] All tests pass (`pytest`)
- [ ] Database migration tested (if applicable)
- [ ] API endpoints documented
- [ ] Error handling implemented
- [ ] Logging added for debugging
- [ ] Frontend integrated (if applicable)
- [ ] Manual end-to-end testing done
- [ ] No breaking changes to existing features
- [ ] Follows `.claude-rules` standards
- [ ] Type hints on all functions (Python)
- [ ] TypeScript types defined (Frontend)

### 10. Commit the Feature

```bash
git add <files>
git commit -m "feat: <clear description of feature>

- Implemented <feature component 1>
- Added <feature component 2>
- Tests: <what was tested>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Common M&A Tracker Feature Patterns

### Adding a New Monitor

1. Create monitor class in `/app/monitors/new_monitor.py`
2. Implement `start()` and `stop()` methods
3. Add to `main.py` startup/shutdown events
4. Create API routes in `/app/api/new_routes.py`
5. Add database tables for monitoring data

### Adding Deal Intelligence

1. Create data model for new intelligence type
2. Add database table/columns
3. Implement extraction logic
4. Store in `deal_intelligence` or related table
5. Add API endpoint to retrieve intelligence

### Adding Alert Type

1. Add alert type to `alert_type` enum in database
2. Implement trigger logic in relevant monitor
3. Create alert message template
4. Test with `alert_notifications` table
5. Add email delivery (future)

## When Stuck

1. Review existing similar features for patterns
2. Check `.claude-rules` for project standards
3. Read test examples in `/tests` directory
4. Verify database schema in `/migrations`
5. Ask specific questions about requirements
