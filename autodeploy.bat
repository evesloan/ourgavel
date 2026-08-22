@echo off
REM OurGavel autodeploy — runs silently on a schedule. Do not double-click this;
REM run install-autodeploy.bat once instead.
REM Picks up anything Claude wrote into this folder, syncs with the site's own
REM robot commits, and pushes. A push triggers the build and deploy.
setlocal
cd /d "%~dp0"
set LOG=%~dp0autodeploy.log

git config user.name "Eve Sloan" >nul 2>&1
git config user.email "evesloan@users.noreply.github.com" >nul 2>&1

REM Take the site's own commits first, so we never push a stale record.
git pull --rebase --autostash >>"%LOG%" 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] PULL FAILED - rebase left in progress, needs a human >>"%LOG%"
  git rebase --abort >nul 2>&1
  exit /b 1
)

git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Apply updates from Claude" >>"%LOG%" 2>&1
  git push >>"%LOG%" 2>&1
  if errorlevel 1 (
    echo [%DATE% %TIME%] PUSH FAILED >>"%LOG%"
    exit /b 1
  )
  echo [%DATE% %TIME%] deployed >>"%LOG%"
) else (
  REM nothing of ours changed; still push if a previous run committed but failed to push
  git status -sb | findstr /C:"ahead" >nul
  if not errorlevel 1 (
    git push >>"%LOG%" 2>&1
    echo [%DATE% %TIME%] pushed backlog >>"%LOG%"
  )
)

REM keep the log from growing forever
for %%A in ("%LOG%") do if %%~zA GTR 200000 (
  more +400 "%LOG%" > "%LOG%.tmp" 2>nul && move /y "%LOG%.tmp" "%LOG%" >nul
)
endlocal
exit /b 0
