# Context & Rules Updates - December 25, 2025

This document summarizes the updates made to project context and rules files following the KRJ date fix implementation.

---

## Files Updated

### 1. `.claude-rules` (Main Project Rules)

**Location:** `/Users/donaldross/dev/ma-tracker-app/.claude-rules`

**Changes Made:**
- Added comprehensive section on **Signal Date Display (metadata.json)**
- Documented the metadata.json format and purpose
- Added **Local Development Workflow** section with step-by-step testing procedures
- Added **Production Deployment Workflow** with complete deployment steps
- Enhanced **Troubleshooting** section with common issues and solutions
- Updated **Important Notes** to reflect current state
- Updated **Future Enhancements** with progress tracking

**Key Additions:**
```markdown
### Signal Date Display (metadata.json)
- How KRJ date works (Friday signals, filename parsing, metadata generation)
- metadata.json format specification
- Critical note about dynamic rendering requirement

### Local Development Workflow
- Testing KRJ changes locally
- Key files reference table
- Commands for clean builds and testing

### Production Deployment Workflow
- Server information
- Step-by-step deployment process
- Quick command reference
- Critical deployment notes

### Troubleshooting
- UI shows wrong date
- Batch script not generating metadata
- Changes not appearing after deployment
```

---

### 2. `docs/KRJ_DEV_WORKFLOW.md` (New File)

**Location:** `/Users/donaldross/dev/ma-tracker-app/docs/KRJ_DEV_WORKFLOW.md`

**Purpose:** Quick reference guide for KRJ development and deployment

**Contents:**
- **Local Development:** Prerequisites, testing procedures, key files
- **Production Deployment:** Server info, deployment process, quick commands
- **Batch Script Workflow:** Current manual process and future automated state
- **Troubleshooting:** Common problems with step-by-step solutions
- **Checklists:** Before/after deployment verification steps
- **Architecture Diagram:** Visual representation of data flow
- **Important Notes:** Critical reminders for developers

**Target Audience:** Developers working on KRJ dashboard, future team members

---

## Why These Updates Matter

### 1. Knowledge Preservation
- Captures the complete dev/prod workflow in one place
- Documents the metadata.json approach and why it's needed
- Preserves troubleshooting knowledge for future issues

### 2. Onboarding Efficiency
- New developers can quickly understand the KRJ deployment process
- Clear step-by-step procedures reduce errors
- Troubleshooting section prevents repeated debugging

### 3. Deployment Safety
- Checklists ensure critical steps aren't missed
- Clear testing procedures catch issues before production
- Documented rollback procedures for emergencies

### 4. Context Continuity
- AI assistants (like Claude) can reference these rules in future sessions
- Reduces need to re-explain architecture in each session
- Maintains consistency across development cycles

---

## Key Concepts Documented

### 1. Metadata-Based Date Display
- **Problem:** CSV filenames contain dates, but UI had no way to access them
- **Solution:** Batch script extracts date → writes metadata.json → UI reads it
- **Critical Detail:** Page must use `export const dynamic = 'force-dynamic'` for server-side rendering

### 2. Docker Image Rebuilding
- **Problem:** Code changes don't automatically appear in running containers
- **Solution:** Must rebuild Docker image after syncing code
- **Command:** `docker build -t ma-tracker-app-dev -f Dockerfile .`

### 3. Local Testing First
- **Principle:** Always test locally before deploying to droplet
- **Workflow:** Clean build → production server → verify → deploy
- **Benefit:** Catches issues early, reduces production debugging

### 4. Two-Environment Architecture
- **Local (Mac):** Development and testing environment
- **Droplet (DigitalOcean):** Production environment
- **Flow:** Local test → rsync → rebuild → restart → verify

---

## Usage Examples

### For Daily Development

```bash
# Developer wants to update KRJ UI
cd /Users/donaldross/dev/ma-tracker-app

# 1. Make changes to app/krj/page.tsx

# 2. Test locally (from .claude-rules)
rm -rf .next && npm run build
npm start
open http://localhost:3000/krj

# 3. Deploy (from KRJ_DEV_WORKFLOW.md)
DROPLET_IP=134.199.204.12 ./deploy-krj-date-fix.sh
ssh don@134.199.204.12
cd /home/don/apps/ma-tracker-app
docker build -t ma-tracker-app-dev -f Dockerfile .
cd /home/don/apps
docker compose restart web
```

### For Troubleshooting

```bash
# UI shows wrong date - check troubleshooting section
# Follow step-by-step solution from .claude-rules or KRJ_DEV_WORKFLOW.md

# 1. Check metadata exists
cat data/krj/metadata.json

# 2. Verify dynamic rendering
grep "export const dynamic" app/krj/page.tsx

# 3. Clear cache and rebuild
rm -rf .next && npm run build

# 4. Hard refresh browser
```

### For AI Assistants

When starting a new session:
1. Read `.claude-rules` for project context
2. Reference `docs/KRJ_DEV_WORKFLOW.md` for specific procedures
3. Check `KRJ_DATE_FIX_DEPLOYMENT_REPORT.md` for implementation details
4. Follow documented workflows without asking for clarification

---

## Maintenance Guidelines

### When to Update These Files

**Update `.claude-rules` when:**
- Adding new services or deployment targets
- Changing core architecture or workflows
- Adding new troubleshooting procedures
- Discovering critical gotchas or edge cases

**Update `docs/KRJ_DEV_WORKFLOW.md` when:**
- Deployment steps change
- New troubleshooting scenarios discovered
- Server configuration changes
- Automation is added (e.g., cron jobs)

**Best Practice:**
- Update documentation in the SAME commit as code changes
- Keep examples current and tested
- Remove outdated information promptly
- Use clear, actionable language

---

## Related Documentation

- `DEPLOYMENT_KRJ.md` - Comprehensive KRJ deployment guide
- `docs/KRJ_DEPLOYMENT_ARCHITECTURE.md` - Technical architecture details
- `KRJ_DATE_FIX_DEPLOYMENT_REPORT.md` - Implementation report for date fix
- `KRJ_DATE_BUG_FIX.md` - Original bug description and fix
- `KRJ_DATE_FIX_SUMMARY.md` - Executive summary of the fix

---

## Success Metrics

These updates are successful if:
- ✅ New developers can deploy KRJ without assistance
- ✅ Common issues are resolved using documented procedures
- ✅ AI assistants can reference rules without re-explanation
- ✅ Deployment errors decrease over time
- ✅ Knowledge is preserved across team changes

---

*Created: 2025-12-25*
*Next Review: After next major KRJ update or deployment change*

