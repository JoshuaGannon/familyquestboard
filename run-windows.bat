@echo off
rem Family Quest Board — start the local server and open the dashboard
rem Double-click this file. Close the "Family Quest Board server" window to stop.
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during install.
  pause
  exit /b 1
)

rem Optional: point the slideshow at your Google Drive folder instead of .\photos
rem set FQB_PHOTOS=G:\My Drive\Wall Photos

start "Family Quest Board server" python server.py
timeout /t 2 >nul

rem Open in an app-style window (Chrome or Edge), falling back to the default browser.
rem Press F11 in the window for full screen.
set CHROME="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set EDGE="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist %CHROME% (
  start "" %CHROME% --new-window --app=http://localhost:8080 --window-size=1920,1080
) else if exist %EDGE% (
  start "" %EDGE% --new-window --app=http://localhost:8080 --window-size=1920,1080
) else (
  start "" http://localhost:8080
)
