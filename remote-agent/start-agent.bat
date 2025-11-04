@echo off
REM Remote AI Agent Startup Script for Windows

echo Starting Remote AI Agent...
echo.

REM Activate conda environment
call C:\Users\%USERNAME%\anaconda3\Scripts\activate.bat remote-agent

REM Navigate to agent directory
cd /d %~dp0

REM Start the agent
python main.py

pause
