@echo off
REM OurGavel one-click deploy. Double-click this file.
REM Commits whatever Claude wrote into this folder, syncs with the site's own
REM robot commits, and pushes -- which triggers a build and deploy.
cd /d "%~dp0"
echo.
echo === OurGavel deploy ===
echo.

REM Identity for this repo only. The noreply address keeps your real email
REM out of the public commit log.
git config user.name "Eve Sloan"
git config user.email "evesloan@users.noreply.github.com"

git add -A
git diff --cached --quiet
if errorlevel 1 (
  echo --- committing changes...
  git commit -m "Apply updates from Claude"
  if errorlevel 1 goto trouble
) else (
  echo --- nothing new to commit
)

echo.
echo --- syncing with the site's automatic updates...
git pull --rebase
if errorlevel 1 goto trouble

echo.
echo --- pushing to GitHub...
git push
if errorlevel 1 goto trouble

echo.
echo ============================================
echo  DONE. GitHub is building the site now.
echo  Live in about 2 minutes at:
echo  https://evesloan.github.io/ourgavel/
echo ============================================
echo.
pause
exit /b 0

:trouble
echo.
echo ============================================
echo  Something needs a human. Copy everything
echo  above this line and send it to Claude.
echo ============================================
echo.
pause
exit /b 1
