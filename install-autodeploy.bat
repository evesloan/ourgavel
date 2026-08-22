@echo off
REM ============================================================
REM  OurGavel — install the autodeploy task. Run this ONCE.
REM  After this, anything Claude writes into this folder goes
REM  live on its own within about five minutes. No more clicking.
REM
REM  Safe to run again at any time: it replaces the existing task.
REM ============================================================
cd /d "%~dp0"
echo.
echo   Installing the OurGavel autodeploy task...
echo.

REM The task runs autodeploy.bat through a tiny VBScript shim instead of running
REM the .bat directly. schtasks launches a .bat through cmd.exe, which opens a
REM console window -- every five minutes, all day, in front of whatever you are
REM doing. wscript.exe has no window and starts the batch hidden, so nothing
REM flashes. Same work, same log, same five minutes; you just stop seeing it.
if not exist "%~dp0autodeploy-silent.vbs" (
  echo   MISSING: autodeploy-silent.vbs
  echo   That file must sit next to this one. Run: git pull
  echo.
  pause
  exit /b 1
)

schtasks /Query /TN "OurGavel autodeploy" >nul 2>&1
if not errorlevel 1 (
  echo   An existing task was found. Replacing it.
  schtasks /Delete /TN "OurGavel autodeploy" /F >nul 2>&1
)

schtasks /Create ^
  /SC MINUTE /MO 5 ^
  /TN "OurGavel autodeploy" ^
  /TR "wscript.exe \"%~dp0autodeploy-silent.vbs\"" ^
  /F
if errorlevel 1 goto failed

REM Do not trust /F. Read the task back and confirm the action really is the shim --
REM a mis-quoted /TR registers happily and then does nothing, every five minutes,
REM forever, with no error anywhere.
schtasks /Query /TN "OurGavel autodeploy" /FO LIST /V | findstr /I "autodeploy-silent.vbs" >nul
if errorlevel 1 (
  echo.
  echo   WARNING: the task exists but its action does not mention autodeploy-silent.vbs.
  echo   Nothing will deploy. Send Claude the output of:
  echo       schtasks /Query /TN "OurGavel autodeploy" /FO LIST /V
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================================
echo    DONE. The task runs every 5 minutes while this PC is on,
echo    with no window on screen.
echo.
echo    - Claude writes files into this folder
echo    - This task commits and pushes them within ~5 minutes
echo    - GitHub rebuilds and the site updates itself
echo.
echo    Log:     autodeploy.log  (in this folder)
echo    Pause:   schtasks /Change /TN "OurGavel autodeploy" /DISABLE
echo    Resume:  schtasks /Change /TN "OurGavel autodeploy" /ENABLE
echo    Remove:  schtasks /Delete /TN "OurGavel autodeploy" /F
echo   ============================================================
echo.

REM Prove the SHIM works, not just the batch file -- this is the exact command
REM line the scheduled task will run. If this deploys, the task will deploy.
echo   Running it once now, the same way the task will...
for /f %%A in ('powershell -NoProfile -Command "(Get-Item ''%~dp0autodeploy.log'').Length" 2^>nul') do set BEFORE=%%A
if not defined BEFORE set BEFORE=0
wscript.exe "%~dp0autodeploy-silent.vbs"
set RC=%ERRORLEVEL%
for /f %%A in ('powershell -NoProfile -Command "(Get-Item ''%~dp0autodeploy.log'').Length" 2^>nul') do set AFTER=%%A
if not defined AFTER set AFTER=0

echo.
if %RC% NEQ 0 (
  echo   The silent run reported a problem ^(exit %RC%^).
  echo   Open autodeploy.log and send Claude the last few lines.
) else if %AFTER% GTR %BEFORE% (
  echo   Test run OK - the hidden task ran and wrote to autodeploy.log.
) else (
  echo   The shim exited cleanly but wrote nothing to autodeploy.log.
  echo   Send Claude that fact; do not assume it worked.
)
echo.
echo   Last lines of the log:
powershell -NoProfile -Command "Get-Content '%~dp0autodeploy.log' -Tail 4" 2>nul
echo.
pause
exit /b 0

:failed
echo.
echo   Could not create the task. Try again from an Administrator
echo   Command Prompt, or send Claude the error above.
echo.
pause
exit /b 1
