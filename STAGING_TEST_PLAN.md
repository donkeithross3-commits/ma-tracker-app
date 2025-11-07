# Staging Environment Test Plan

**Purpose:** Validate deployment scripts and procedures before Luis installation
**Staging PC:** Windows via ngrok tunnel
**AI Agent URL:** https://charissa-gesticulatory-grovelingly.ngrok-free.dev

---

## Test Objectives

1. ✅ Verify staging PC has required software (Node.js, Python, Git)
2. ✅ Test installation script execution
3. ✅ Verify database connectivity from staging
4. ✅ Test Python service + TWS connection
5. ✅ Test Next.js app startup
6. ✅ End-to-end options scanner test

---

## Remote Testing via AI Agent

We can test the deployment remotely using the AI agent running on the staging PC.

### Connection Info

```bash
STAGING_AGENT_URL="https://charissa-gesticulatory-grovelingly.ngrok-free.dev"
STAGING_AGENT_API_KEY="HKJMKiQqisZBOX2zDbGTePJ03hCqX54XiTMf9SEAZFU="
```

### Test Commands

#### 1. Check Prerequisites

```bash
curl -X POST https://charissa-gesticulatory-grovelingly.ngrok-free.dev/execute \
  -H "Authorization: Bearer HKJMKiQqisZBOX2zDbGTePJ03hCqX54XiTMf9SEAZFU=" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "node --version && npm --version && python --version && git --version"
  }'
```

Expected: All version numbers print successfully

#### 2. Check if Project Already Exists

```bash
curl -X POST https://charissa-gesticulatory-grovelingly.ngrok-free.dev/execute \
  -H "Authorization: Bearer HKJMKiQqisZBOX2zDbGTePJ03hCqX54XiTMf9SEAZFU=" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "dir C:\\Projects\\ma-tracker-app"
  }'
```

#### 3. Pull Latest Code (if exists)

```bash
curl -X POST https://charissa-gesticulatory-grovelingly.ngrok-free.dev/execute \
  -H "Authorization: Bearer HKJMKiQqisZBOX2zDbGTePJ03hCqX54XiTMf9SEAZFU=" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "cd C:\\Projects\\ma-tracker-app && git status && git pull"
  }'
```

#### 4. Run Installation Script

```bash
curl -X POST https://charissa-gesticulatory-grovelingly.ngrok-free.dev/execute \
  -H "Authorization: Bearer HKJMKiQqisZBOX2zDbGTePJ03hCqX54XiTMf9SEAZFU=" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "cd C:\\Projects\\ma-tracker-app && powershell -ExecutionPolicy Bypass -File .\\scripts\\windows-install.ps1",
    "timeout": 600000
  }'
```

Expected: "Installation Complete! ✅"

#### 5. Test Database Connection

```bash
curl -X POST https://charissa-gesticulatory-grovelingly.ngrok-free.dev/execute \
  -H "Authorization: Bearer HKJMKiQqisZBOX2zDbGTePJ03hCqX54XiTMf9SEAZFU=" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "cd C:\\Projects\\ma-tracker-app && npm run db:generate"
  }'
```

Expected: "Generated Prisma Client"

#### 6. Check TWS Status

```bash
curl -X POST https://charissa-gesticulatory-grovelingly.ngrok-free.dev/execute \
  -H "Authorization: Bearer HKJMKiQqisZBOX2zDbGTePJ03hCqX54XiTMf9SEAZFU=" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "netstat -an | findstr :7497"
  }'
```

Expected: Port 7497 is listening

---

## Manual Testing Steps (If AI Agent Has Issues)

### Option A: TeamViewer/AnyDesk

1. Connect to staging PC via remote desktop
2. Open PowerShell
3. Run installation script manually
4. Verify each step

### Option B: Screen Share with User

1. Have user on staging PC
2. Walk through steps via voice/video
3. Debug any issues in real-time

---

## Test Scenarios

### Scenario 1: Fresh Installation

- [ ] Clone repository
- [ ] Run installation script
- [ ] Start services
- [ ] Access web app
- [ ] Login with demo credentials
- [ ] View deals dashboard

### Scenario 2: Update Existing Installation

- [ ] Navigate to project
- [ ] Run `git pull`
- [ ] Run `npm install`
- [ ] Restart services
- [ ] Verify changes applied

### Scenario 3: Options Scanner

- [ ] Start TWS (if not already running)
- [ ] Start Python service
- [ ] Start Next.js app
- [ ] Navigate to Options Scanner
- [ ] Click "Start Scan"
- [ ] Verify data populates

### Scenario 4: Error Recovery

- [ ] Kill services mid-operation
- [ ] Restart services
- [ ] Verify system recovers gracefully

---

## Success Criteria

✅ Installation completes without errors
✅ All services start successfully
✅ Web app is accessible on localhost:3000
✅ Database queries work
✅ Python service connects to TWS
✅ Options scanner retrieves data (during market hours)

---

## Known Issues & Workarounds

### Issue: PowerShell Execution Policy

**Error:** "Execution policy does not allow running scripts"

**Workaround:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Issue: Port Already in Use

**Error:** "Port 3000 is already in use"

**Workaround:**
```powershell
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Issue: Python Virtual Environment Won't Activate

**Error:** "Cannot activate virtual environment"

**Workaround:**
- Ensure Python is in PATH
- Try running PowerShell as Administrator
- Use `venv\Scripts\activate.bat` instead

---

## Rollback Plan

If deployment fails catastrophically:

1. Stop all services
2. Delete project folder
3. Re-clone repository
4. Run installation from scratch

---

## Next Steps After Successful Staging Test

1. ✅ Document any issues encountered
2. ✅ Update installation scripts if needed
3. ✅ Create FAQ from common errors
4. ✅ Schedule Luis deployment
5. ✅ Prepare remote support tools

---

## Testing Timeline

- **Now (7:00 AM CT):** Create deployment package
- **7:15 AM CT:** Test on staging via AI agent
- **7:30 AM CT:** Fix any issues found
- **7:45 AM CT:** Luis can start installation
- **8:30 AM CT:** Test options scanner (market open)

---

## Contact for Issues

- **Don:** Primary support
- **Staging PC:** Access via AI agent or remote desktop
- **Luis:** Can test in parallel on his machine
