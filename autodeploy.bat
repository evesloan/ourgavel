@echo off
REM OurGavel autodeploy — runs silently on a schedule. Do not double-click this;
REM run install-autodeploy.bat once instead.
REM Picks up anything Claude wrote into this folder, syncs with the site's own
REM robot commits, and pushes. A push triggers the build and deploy.
setlocal
cd /d "%~dp0"
set LOG=%~dp0autodeploy.log
set BLOCKED=%~dp0DEPLOY-BLOCKED.txt

git config user.name "Eve Sloan" >nul 2>&1
git config user.email "evesloan@users.noreply.github.com" >nul 2>&1

REM Take the site's own commits first, so we never push a stale record.
git pull --rebase --autostash >>"%LOG%" 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] PULL FAILED - rebase left in progress, needs a human >>"%LOG%"
  git rebase --abort >nul 2>&1
  exit /b 1
)

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
