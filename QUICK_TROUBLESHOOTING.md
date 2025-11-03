# Quick Troubleshooting Reference

## Most Common Issues (90% of problems)

### 1. ngrok URL Changed
**Symptom:** Dashboard shows "Scanner offline" or JSON parse errors

**Fix:**
```bash
# In Git Bash, check your current URL:
curl http://localhost:4040/api/tunnels | grep public_url

# Update Vercel with new URL:
# https://vercel.com/...projects/ma-tracker-app/settings/environment-variables
# Set PYTHON_SERVICE_URL to your new ngrok URL
```

### 2. IB Gateway Not Connected
**Symptom:** `curl http://localhost:8000/health` shows `"ib_connected":false`

**Fix:**
1. Start IB Gateway/TWS
2. Log in
3. Verify API settings: Settings → API → Settings
4. Restart scanner: `~/start-scanner.sh`

### 3. Scanner Not Running
**Symptom:** `curl http://localhost:8000/health` fails

**Fix:**
```bash
# Restart scanner:
~/start-scanner.sh
```

### 4. Market Closed / No Data
**Symptom:** Scanner returns empty opportunities

**Fix:**
- Try during market hours (9:30 AM - 4:00 PM ET)
- Verify options data subscription in IB account

---

## Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| "bash: command not found: git" | Git not installed | Install Git for Windows, use Git Bash |
| "Python 3 is not installed" | Python not in PATH | Reinstall Python, check "Add to PATH" |
| "pip is not installed" | pip not found | Use `python -m pip` instead |
| "ngrok is not authenticated" | Missing auth token | Run `ngrok config add-authtoken TOKEN` |
| "Cannot connect to IB" | IB Gateway not running | Start IB Gateway, enable API |
| "No option data available" | Outside market hours | Try during market hours |
| "Unexpected token '<'" | ngrok URL changed | Update Vercel env variable |

---

## Quick Commands

```bash
# Check everything is running:
curl http://localhost:8000/health              # Scanner health
curl http://localhost:4040/api/tunnels         # ngrok URL

# View logs:
tail -f /tmp/scanner.log                       # Scanner log
tail -f /tmp/ngrok.log                         # ngrok log

# Restart scanner:
# Press Ctrl+C in scanner terminal, then:
~/start-scanner.sh

# Test scanner directly:
curl http://localhost:8000/test-scan/AAPL
```

---

## Daily Checklist

Before market open:
- [ ] Start IB Gateway/TWS and log in
- [ ] Run `~/start-scanner.sh` in Git Bash
- [ ] Verify ngrok URL hasn't changed
- [ ] Test dashboard loads
- [ ] Try a test scan

---

## When All Else Fails

1. **Restart everything:**
   ```bash
   # Close Git Bash terminal (kills scanner + ngrok)
   # Close IB Gateway
   # Restart IB Gateway, log in
   # Open Git Bash, run:
   ~/start-scanner.sh
   ```

2. **Pull latest fixes:**
   ```bash
   cd ~/ma-tracker-app
   git pull origin main
   ```

3. **Reinstall Python packages:**
   ```bash
   cd ~/ma-tracker-app/python-service
   python -m pip install --upgrade -r requirements.txt
   ```

---

## Contact

If none of the above fixes work, check:
- Full setup guide: `LUIS_WINDOWS_SETUP.md`
- Scanner logs: `/tmp/scanner.log`
- ngrok web UI: http://localhost:4040
