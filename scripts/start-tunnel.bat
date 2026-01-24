@echo off
REM Start Cloudflare Tunnel for KRJ UI external access

echo ==========================================
echo Starting Cloudflare Tunnel for KRJ
echo ==========================================
echo.

REM Check if cloudflared is installed
where cloudflared >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo cloudflared not found
    echo.
    echo Download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    exit /b 1
)

REM Create .cloudflared directory
if not exist .cloudflared mkdir .cloudflared

REM Start Quick Tunnel
echo Starting Quick Tunnel...
echo This will generate a temporary public URL
echo.

start /B cloudflared tunnel --url http://localhost:3000 > .cloudflared\tunnel.log 2>&1

REM Wait for tunnel
timeout /t 5 /nobreak >nul

REM Extract URL (Windows doesn't have grep, use findstr)
for /f "tokens=*" %%i in ('findstr /R "https://.*\.trycloudflare\.com" .cloudflared\tunnel.log') do set TUNNEL_LINE=%%i

echo.
echo ==========================================
echo Cloudflare Tunnel Active
echo ==========================================
echo.
echo Check .cloudflared\tunnel.log for the public URL
echo.
echo Press Ctrl+C to stop
echo ==========================================
echo.

pause

