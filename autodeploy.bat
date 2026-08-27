@echo off
REM OurGavel autodeploy — runs silently on a schedule. Do not double-click this;
REM run install-autodeploy.bat once instead.
REM Picks up anything Claude wrote into this folder, syncs with the site's own
REM robot commits, and pushes. A push triggers the build and deploy.
REM Since 2026-08-27 it is also the pulse's keepalive: GitHub's cron scheduler dropped the
REM site's 15-minute pulse for ~10 hours twice in one day, and a push is the one trigger
REM that fires reliably. If main has been quiet ~40 minutes, this script writes a one-line
REM heartbeat so its normal commit+push path nudges the pulse awake.
setlocal enabledelayedexpansion
cd /d "%~dp0"
set LOG=%~dp0autodeploy.log
set BLOCKED=%~dp0DEPLOY-BLOCKED.txt

REM The shipper task mutates the tree over several minutes: apply a patch, build, run the
REM suite, then commit only if it all passed. This script runs every five minutes and would
REM otherwise `git add -A` that half-finished state and push it -- committing unverified work
REM and defeating the gate entirely. So it stands aside while the lock is held.
REM A lock older than 45 minutes is treated as abandoned, because a shipper that died holding
REM one must not stop deploys forever.
set LOCK=%~dp0SHIPPING.lock
if exist "%LOCK%" (
  for /f %%A in ('powershell -NoProfile -Command "[int](((Get-Date) - (Get-Item ''%LOCK%'').LastWriteTime).TotalMinutes)" 2^>nul') do set LOCKAGE=%%A
  if not defined LOCKAGE set LOCKAGE=0
  if !LOCKAGE! LSS 45 (
    echo [%DATE% %TIME%] shipper holds the lock ^(!LOCKAGE!m^) - standing aside >>"%LOG%"
    exit /b 0
  )
  echo [%DATE% %TIME%] STALE lock ^(!LOCKAGE!m^) - removing and proceeding >>"%LOG%"
  del /q "%LOCK%" >nul 2>&1
)

git config user.name "Eve Sloan" >nul 2>&1
git config user.email "evesloan@users.noreply.github.com" >nul 2>&1

REM Take the site's own commits first, so we never push a stale record.
git pull --rebase --autostash >>"%LOG%" 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] PULL FAILED - rebase left in progress, needs a human >>"%LOG%"
  git rebase --abort >nul 2>&1
  exit /b 1
)

REM --- Pulse keepalive (2026-08-27). ---
REM The pulse workflow fires on every push, but its cron schedule has proven unreliable
REM (dropped for ~10h twice on Aug 27 — GitHub-side, nothing in this repo). While the pulse
REM is asleep nothing on the site updates and, worse, the verdict engine cannot see the
REM world: a verdict returned during a dead spell would go unpublished. So: track how long
REM main has sat unchanged across runs of this script (marker lives in %TEMP%, never in the
REM repo). Eight consecutive quiet runs at the 5-minute cadence = ~40 minutes = write a
REM one-line heartbeat file; the normal commit+push below then fires the pulse. While the
REM cron is healthy main moves every ~15 minutes and this never triggers at all.
set HB=%TEMP%\ourgavel-pulse-heartbeat.txt
set CURHEAD=
for /f %%A in ('git rev-parse HEAD 2^>nul') do set CURHEAD=%%A
set LASTHEAD=
set STALLN=0
if exist "%HB%" for /f "usebackq tokens=1,2" %%A in ("%HB%") do (
  set LASTHEAD=%%A
  set STALLN=%%B
)
if not defined STALLN set STALLN=0
if "%CURHEAD%"=="!LASTHEAD!" (set /a STALLN+=1) else (set STALLN=0)
if !STALLN! GEQ 8 (
  > "data\heartbeat.txt" echo pulse keepalive %DATE% %TIME% - main was quiet ~40 minutes
  echo [%DATE% %TIME%] heartbeat: main quiet ~40m, nudging the pulse >>"%LOG%"
  set STALLN=0
)
> "%HB%" echo %CURHEAD% !STALLN!

REM --- The check this script was missing, and the reason it once shipped a broken site. ---
REM `git pull --rebase --autostash` exits 0 even when the autostash POP conflicts. Git leaves
REM merge markers sitting in the file, `git add -A` stages them, and they get committed. That
REM is how "<<<<<<< Updated upstream" ended up inside a case.json: invalid JSON, build dead,
REM and nothing in the log said so. Never commit a conflicted tree.
git ls-files -u | findstr /R "." >nul
if not errorlevel 1 goto :blocked

git add -A

REM Belt and braces: catch markers being introduced even if git considers the tree merged.
git diff --cached -U0 | findstr /B /C:"+<<<<<<< " /C:"+>>>>>>> " >nul
if not errorlevel 1 (
  git reset >nul 2>&1
  goto :blocked
)

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

REM A clean run clears any previous alert.
if exist "%BLOCKED%" del /q "%BLOCKED%" >nul 2>&1
goto :housekeeping

:blocked
echo [%DATE% %TIME%] BLOCKED - conflict markers in the working tree, nothing committed >>"%LOG%"
> "%BLOCKED%" echo OurGavel deploy is STOPPED.
>>"%BLOCKED%" echo.
>>"%BLOCKED%" echo A pull left merge-conflict markers in one or more files. Committing them would
>>"%BLOCKED%" echo put invalid data on the site, so this script stopped instead of pushing.
>>"%BLOCKED%" echo.
>>"%BLOCKED%" echo Files affected:
>>"%BLOCKED%" git --no-pager grep -l -E "^(<<<<<<< ^|>>>>>>> )" -- . 2^>nul
>>"%BLOCKED%" echo.
>>"%BLOCKED%" echo Fix: open each file, keep the correct version, delete the ^<^<^<^<^<^<^< / ======= /
>>"%BLOCKED%" echo ^>^>^>^>^>^>^> lines, then run:  node scripts\preflight.js
>>"%BLOCKED%" echo Deploys resume automatically on the next run once preflight passes.
git --no-pager grep -n -E "^(<<<<<<< |>>>>>>> )" -- . >>"%LOG%" 2>&1
exit /b 1

:housekeeping
REM keep the log from growing forever
for %%A in ("%LOG%") do if %%~zA GTR 200000 (
  more +400 "%LOG%" > "%LOG%.tmp" 2>nul && move /y "%LOG%.tmp" "%LOG%" >nul
)
endlocal
exit /b 0
