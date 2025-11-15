# Bug Fix Mode

You are in **BUG FIX MODE** for the M&A Intelligence Tracker project.

## Your Mission

Fix bugs systematically with minimal risk and maximum verification.

## Workflow

### 1. Understand the Bug

First, gather information:
- Read the bug report or error message
- Identify affected components
- Check relevant logs
- Reproduce the issue (if possible)

**Ask yourself:**
- What is the expected behavior?
- What is the actual behavior?
- When did this start happening?
- What changed recently? (`git log --oneline -10`)

### 2. Locate the Root Cause

**Backend (Python) bugs:**
```bash
# Check service logs
tail -f python-service/logs/*.log  # if logging to file

# Test API endpoint
curl http://localhost:8000/endpoint

# Check database state
# Use psql or Python script to query relevant tables
```

**Frontend (Next.js) bugs:**
```bash
# Check browser console
# Check Next.js terminal output
# Test in incognito window (to rule out cache)
```

**Database bugs:**
```bash
# Check migration history
ls -la python-service/migrations/

# Verify table schema
# Query data directly
```

### 3. Write a Test (Test-First!)

**Backend test** (`python-service/tests/test_bugfix.py`):
```python
import pytest

def test_bug_is_fixed():
    """Test that demonstrates the bug, then proves the fix"""
    # Arrange - Set up conditions that trigger the bug

    # Act - Perform the action that was failing

    # Assert - Verify the bug is fixed
    assert expected == actual
```

**Run the test (should FAIL initially):**
```bash
cd python-service
pytest tests/test_bugfix.py -v
```

### 4. Fix the Bug

**Principles:**
- Make the smallest possible change
- Fix the root cause, not symptoms
- Preserve existing behavior for other use cases
- Add error handling if missing
- Log important state changes

**Common Bug Patterns in M&A Tracker:**

**A. Database connection issues:**
- Check `DATABASE_URL` environment variable
- Verify connection pool is initialized
- Add proper error handling

**B. Monitor failures:**
- Check if service is running: `/edgar/status`, `/halts/status`
- Verify external URLs are accessible
- Add timeout handling

**C. Data parsing errors:**
- Add input validation
- Handle missing/null fields
- Add try/catch with logging

**D. Race conditions:**
- Use database transactions
- Add proper locking if needed
- Handle concurrent updates

### 5. Verify the Fix

Run checks in order:

```bash
# 1. Unit test passes
pytest tests/test_bugfix.py -v

# 2. All tests still pass
pytest

# 3. Service starts correctly
python3 start_server.py

# 4. Manual verification
curl http://localhost:8000/health

# 5. Check related functionality still works
```

### 6. Check for Side Effects

**Critical checks:**
- [ ] Database migrations still work
- [ ] Background monitors still run
- [ ] API endpoints still respond
- [ ] Frontend still loads
- [ ] No new console errors

### 7. Commit the Fix

Follow Conventional Commits:

```bash
git add <changed files>
git commit -m "fix: <clear description of what was fixed>

- Root cause: <brief explanation>
- Fix: <what you changed>
- Test: <how you verified>

Fixes #<issue-number> (if applicable)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Bug Fix Checklist

Before marking as complete:

- [ ] Bug is reproducible and root cause identified
- [ ] Test written that fails before fix
- [ ] Minimal fix applied
- [ ] Test now passes
- [ ] All existing tests still pass
- [ ] Service starts without errors
- [ ] Manual verification performed
- [ ] No side effects detected
- [ ] Code follows project standards (.claude-rules)
- [ ] Error handling added if needed
- [ ] Logging added for debugging
- [ ] Commit created with clear message

## Emergency Bug Procedures

### Service Won't Start
1. Check logs for error messages
2. Verify DATABASE_URL is set
3. Check port conflicts: `lsof -i :8000`
4. Try restarting: `pkill -f "start_server.py" && python3 start_server.py`
5. Check recent commits: `git log --oneline -5`

### Database Migration Failed
1. **DO NOT** manually edit database
2. Check migration SQL syntax
3. Test on dev database copy
4. Create rollback migration if needed
5. Document the issue

### Monitor Stopped Working
1. Check status endpoint
2. Review logs for errors
3. Verify external service availability
4. Check database connections
5. Restart Python service if needed

## Common M&A Tracker Bugs

### EDGAR Monitor Issues
- **Symptom**: No new filings detected
- **Check**: `/edgar/status`, verify SEC.gov is accessible
- **Common fix**: Timeout handling, HTML parsing updates

### Halt Monitor Issues
- **Symptom**: Halts not being detected
- **Check**: `/halts/status`, verify NASDAQ/NYSE pages load
- **Common fix**: HTML table structure changed, need parser update

### Deal Intelligence Issues
- **Symptom**: Duplicates or missing deals
- **Check**: Database query logic, unique constraints
- **Common fix**: Deduplication logic, add database indexes

### Alert Issues
- **Symptom**: Alerts not firing
- **Check**: `alert_notifications` table, recipient configuration
- **Common fix**: Alert trigger conditions, email delivery setup

## After the Fix

Document the bug and fix:
1. Update any affected documentation
2. Add comment in code explaining the fix (if non-obvious)
3. Consider if similar bugs exist elsewhere
4. Update `.claude-rules` if pattern should be avoided

## When Stuck

1. Check existing code for similar patterns
2. Review recent commits: `git log --oneline -20`
3. Search for error message in codebase
4. Test in isolation (minimal reproduction)
5. Ask for help with specific error details
