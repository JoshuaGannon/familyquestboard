@echo off
setlocal EnableDelayedExpansion
title Family Quest Board - install on the Pi
cd /d "%~dp0"

echo.
echo  ===== Family Quest Board - install / update on the Raspberry Pi =====
echo.
echo  First run: copies everything to the Pi, installs it, and reboots the Pi
echo  into full-screen mode. Later runs: copies your changes and restarts it.
echo.

rem ---------------------------------------------------------------- target
set CFG=pi\pi-target.txt
set TARGET=
if exist "%CFG%" set /p TARGET=<"%CFG%"
if "%TARGET%"=="" (
  echo  What is the Pi's login?  Examples:  pi@raspberrypi.local   or   pi@192.168.1.50
  set /p TARGET="  user@host: "
  echo !TARGET!>"%CFG%"
)
echo  Pi: %TARGET%   (change it in %CFG%)
echo.

rem ---------------------------------------------------------------- sanity
where ssh >nul 2>&1 || (
  echo  ssh/scp not found. On Windows 10/11 go to Settings ^> Apps ^> Optional features
  echo  and add "OpenSSH Client", then run this again.
  pause & exit /b 1
)
findstr /C:"APPS_SCRIPT_URL: \"\"" dashboard\config.js >nul 2>&1 && (
  echo  WARNING: dashboard\config.js has no Apps Script URL - the Pi will start in
  echo  DEMO mode. You can paste the URL later under Parents ^> Settings on the Pi,
  echo  or press Ctrl+C now, fill in config.js, and run this again.
  echo.
  pause
)

rem ---------------------------------------------------------------- ssh key (so you type the password once)
if not exist "%USERPROFILE%\.ssh\id_ed25519.pub" (
  echo  Creating an SSH key so future runs don't ask for a password...
  ssh-keygen -t ed25519 -N "" -f "%USERPROFILE%\.ssh\id_ed25519" -q
)
echo  Checking connection (enter the Pi password if asked)...
ssh -o ConnectTimeout=8 -o BatchMode=yes %TARGET% "true" >nul 2>&1
if errorlevel 1 (
  type "%USERPROFILE%\.ssh\id_ed25519.pub" | ssh -o ConnectTimeout=8 %TARGET% "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
  if errorlevel 1 (
    echo.
    echo  Could not reach %TARGET%. Is the Pi on, on the same Wi-Fi, with SSH enabled?
    echo  Try the IP address instead of the name: delete %CFG% and run again.
    pause & exit /b 1
  )
)

rem ---------------------------------------------------------------- copy
echo.
echo  Copying files to the Pi...
ssh %TARGET% "mkdir -p ~/FamilyQuestBoard/photos"
scp -q -r dashboard pi apps-script server.py README.md %TARGET%:FamilyQuestBoard/ || (echo  Copy failed. & pause & exit /b 1)

rem ---------------------------------------------------------------- install or update
echo.
ssh %TARGET% "test -f /etc/systemd/system/fqb-server.service" >nul 2>&1
if errorlevel 1 (
  echo  First install - this takes a few minutes ^(downloads Chromium^)...
  echo.
  ssh -t %TARGET% "cd ~/FamilyQuestBoard && sed -i 's/\r$//' pi/*.sh server.py && bash pi/setup-pi.sh"
  if errorlevel 1 (echo. & echo  Setup reported a problem - see above. & pause & exit /b 1)
  echo.
  echo  Rebooting the Pi. It will come up full screen in about a minute.
  ssh %TARGET% "sudo reboot" >nul 2>&1
) else (
  echo  Already installed - restarting with the new files...
  ssh %TARGET% "cd ~/FamilyQuestBoard && sed -i 's/\r$//' pi/*.sh server.py && bash pi/update.sh"
)

for /f "tokens=2 delims=@" %%h in ("%TARGET%") do set PIHOST=%%h
echo.
echo  ===== Done =====
echo  On your phone (same Wi-Fi):  http://%PIHOST%:8080
echo  Run this file again any time to push updates.
echo.
pause
