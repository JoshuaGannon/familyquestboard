@echo off
setlocal
title Family Quest Board - publish to GitHub
cd /d "%~dp0"
rem Pushes this folder to GitHub. The Pi pulls from GitHub every minute, so this
rem is the "send to the wall" button. Needs Git for Windows: https://git-scm.com/download/win
rem (first push opens a browser window to sign in to GitHub - once).

set REPO=https://github.com/JoshuaGannon/familyquestboard.git

where git >nul 2>&1 || (
  echo  Git is not installed. Get it from https://git-scm.com/download/win  ^(defaults are fine^), then run this again.
  pause & exit /b 1
)
if not exist ".git" (
  git init -b main >nul 2>&1 || git init >nul 2>&1
  git remote add origin %REPO%
  git config user.name "Josh" >nul
  git config user.email "you@users.noreply.github.com" >nul
)
git remote set-url origin %REPO% >nul 2>&1
git add -A
git commit -q -m "Update %date% %time%" 2>nul
git pull -q --rebase origin main 2>nul
git push -u origin HEAD:main
if errorlevel 1 (
  echo.
  echo  Push failed - see above. If it asked you to sign in, finish that and run again.
  pause & exit /b 1
)
echo.
echo  Published. The Pi will pick it up within a minute.
timeout /t 4 >nul
