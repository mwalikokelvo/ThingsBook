@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python is required. Install Python 3 and enable its PATH option.
  pause
  exit /b 1
)
python server.py
pause
