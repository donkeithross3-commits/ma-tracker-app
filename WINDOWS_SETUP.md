# Windows Setup Instructions

## For Windows Users

If you're on Windows, you have two options:

---

## Option 1: Use Git Bash (Recommended - Easiest!)

Git Bash comes with Git for Windows and lets you run Unix commands.

### Steps:

1. **Install Git for Windows**: https://git-scm.com/download/win
   - During installation, accept all defaults

2. **Open Git Bash**:
   - Press Windows key
   - Type "Git Bash"
   - Click on "Git Bash" application

3. **Run the setup commands**:
   ```bash
   cd ~/Documents
   git clone https://github.com/donkeithross3-commits/ma-tracker-app.git
   cd ma-tracker-app
   chmod +x setup-for-luis.sh
   ./setup-for-luis.sh
   ```

4. **Follow the prompts** in the setup script

---

## Option 2: Use Windows Command Prompt

If you prefer using Windows Command Prompt:

### Prerequisites:
- Git: https://git-scm.com/download/win
- Python 3: https://www.python.org/downloads/
  - ⚠️ **IMPORTANT**: During Python installation, check "Add Python to PATH"

### Steps:

1. **Open Command Prompt**:
   - Press `Windows + R`
   - Type `cmd`
   - Press Enter

2. **Navigate to Documents and clone repo**:
   ```cmd
   cd %USERPROFILE%\Documents
   git clone https://github.com/donkeithross3-commits/ma-tracker-app.git
   cd ma-tracker-app
   ```

3. **Install Python dependencies**:
   ```cmd
   cd python-service
   pip install -r requirements.txt
   cd ..
   ```

4. **Download and install ngrok**:
   - Go to: https://ngrok.com/download
   - Download the Windows version
   - Extract ngrok.exe to `C:\Windows\System32\` (or any folder in your PATH)

5. **Get ngrok auth token** (one-time):
   - Sign up: https://dashboard.ngrok.com/signup
   - Get token: https://dashboard.ngrok.com/get-started/your-authtoken
   - Run: `ngrok config add-authtoken YOUR_TOKEN_HERE`

6. **Create startup script**:
   - Create a file called `start-scanner.bat` in the `ma-tracker-app` folder
   - Copy this content:

```batch
@echo off
echo Starting M&A Options Scanner...
echo.

REM Start Python service
cd python-service
start /B python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
timeout /t 3 /nobreak > nul
cd ..

REM Check if service is running
curl -s http://localhost:8000/health > nul 2>&1
if %ERRORLEVEL% == 0 (
    echo Python service is running
) else (
    echo Warning: Python service may not be running correctly
)

REM Start ngrok tunnel
start /B ngrok http 8000
timeout /t 3 /nobreak > nul

echo.
echo ==========================================
echo Scanner is starting...
echo ==========================================
echo.
echo Open http://localhost:4040 to see your public URL
echo.
echo Keep this window open!
echo Press Ctrl+C to stop the scanner
echo ==========================================
echo.

pause
```

7. **Start the scanner**:
   ```cmd
   start-scanner.bat
   ```

---

## Daily Use

### Git Bash:
```bash
cd ~/Documents/ma-tracker-app
./start-scanner.sh
```

### Windows Command Prompt:
```cmd
cd %USERPROFILE%\Documents\ma-tracker-app
start-scanner.bat
```

---

## Troubleshooting

### "git is not recognized"
- Install Git for Windows: https://git-scm.com/download/win
- Restart Command Prompt after installation

### "python is not recognized"
- Install Python 3: https://www.python.org/downloads/
- **IMPORTANT**: Re-run installer and check "Add Python to PATH"
- Restart Command Prompt after installation

### "pip is not recognized"
- Python 3 includes pip by default
- If missing, reinstall Python and check "pip" during installation

### Can't find Git Bash
- After installing Git for Windows, look in Start menu for "Git Bash"
- Or right-click in any folder → "Git Bash Here"

---

## Which Option Should You Choose?

**Use Git Bash if:**
- ✅ You want the easiest setup (just install Git and run the commands)
- ✅ You're comfortable following Unix-style instructions
- ✅ This is recommended for most users

**Use Command Prompt if:**
- ✅ You already have a Windows workflow you prefer
- ✅ You want to use native Windows commands
- ✅ You want to create Windows batch files

---

## Need Help?

If you're stuck, the easiest path is:
1. Install Git for Windows
2. Open Git Bash
3. Run the Unix commands from the email

This way you can follow the exact same instructions as Mac/Linux users!
