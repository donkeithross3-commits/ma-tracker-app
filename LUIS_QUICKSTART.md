# Luis Quick Start Checklist ✅

**Time Required:** 30-45 minutes
**Status:** Ready for deployment

---

## Pre-Installation Checklist

Print this out and check off each step!

### 1. Prerequisites (15 minutes)

- [ ] Download Node.js LTS from https://nodejs.org/
  - [ ] Run installer
  - [ ] Accept all defaults
  - [ ] Verify: Open PowerShell and type `node --version`

- [ ] Download Python 3.9+ from https://www.python.org/downloads/
  - [ ] Run installer
  - [ ] ✅ **CHECK "Add Python to PATH"**
  - [ ] Verify: Open PowerShell and type `python --version`

- [ ] Download Git from https://git-scm.com/download/win
  - [ ] Run installer
  - [ ] Accept all defaults
  - [ ] Verify: Open PowerShell and type `git --version`

- [ ] Verify TWS/IB Gateway is installed
  - [ ] Open TWS
  - [ ] Go to File → Global Configuration → API → Settings
  - [ ] Enable "Enable ActiveX and Socket Clients"
  - [ ] Set Socket port to **7497**
  - [ ] Add **127.0.0.1** to Trusted IPs
  - [ ] Uncheck "Read-Only API"
  - [ ] Click OK and restart TWS

---

### 2. Installation (15 minutes)

- [ ] Open PowerShell
- [ ] Navigate to your projects folder:
  ```powershell
  cd C:\Users\Luis\Projects
  ```
  (Create this folder if it doesn't exist)

- [ ] Clone the repository (Don will provide the URL):
  ```powershell
  git clone [URL-FROM-DON]
  cd ma-tracker-app
  ```

- [ ] Run the installation script:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\windows-install.ps1
  ```

- [ ] Wait for installation to complete (2-5 minutes)

- [ ] Verify you see "Installation Complete! ✅"

---

### 3. First Run (5 minutes)

- [ ] Make sure TWS is running and logged in

- [ ] Double-click `start-all-services.bat` in the project folder

- [ ] Two windows should open:
  - [ ] "Python Service" window
  - [ ] "Next.js App" window

- [ ] Wait for both to say "ready" or "running"

- [ ] Open Chrome/Edge and go to: http://localhost:3000

- [ ] Login with:
  - Email: `demo@example.com`
  - Password: `demo123`

- [ ] You should see the M&A Tracker dashboard! 🎉

---

### 4. Test Options Scanner (WAIT UNTIL 8:30 AM CT!)

- [ ] It's 8:30 AM CT or later (markets are open)

- [ ] TWS is running and connected

- [ ] In the app, click "Positions" in the sidebar

- [ ] Click "Options Scanner" tab

- [ ] Click "Start Scan" button

- [ ] You should see options data appearing! 📊

---

## If Something Goes Wrong

### Can't install Python

1. Make sure you checked "Add Python to PATH"
2. Restart your computer
3. Try `python --version` again

### Can't start Python service

1. TWS must be running first
2. Check TWS API settings (port 7497)
3. Check 127.0.0.1 is in Trusted IPs

### Web page won't load

1. Make sure both services are running
2. Try refreshing the page
3. Check Windows Firewall isn't blocking port 3000

### "Port already in use" error

```powershell
# Find what's using the port
netstat -ano | findstr :3000

# Kill it (replace 1234 with actual PID)
taskkill /PID 1234 /F
```

---

## Daily Usage

Once everything is set up:

1. Start TWS
2. Double-click `start-all-services.bat`
3. Open http://localhost:3000
4. Start scanning! 🚀

To stop:
- Close both terminal windows
- Or press Ctrl+C in each window

---

## Contact Don

If you get stuck:
- **Call:** XXX-XXX-XXXX
- **Slack:** @don
- **Email:** don@example.com
- **Remote Help:** Don can connect to help debug

Take screenshots of any errors!

---

## What You're Getting

✅ **Web App** - View and manage M&A deals
✅ **Options Scanner** - Real-time options data from TWS
✅ **Research Reports** - AI-powered merger analysis
✅ **Shared Database** - Same data as Don's system
✅ **Auto-updates** - Just run `git pull` when Don tells you

---

**Next:** After you're comfortable, we'll set this up to run 24/7 as a Windows service!
