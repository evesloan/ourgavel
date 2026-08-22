@echo off
REM ============================================================
REM  OurGavel — install the autodeploy task. Run this ONCE.
REM  After this, anything Claude writes into this folder goes
REM  live on its own within about five minutes. No more clicking.
REM ============================================================
cd /d "%~dp0"
echo.
echo   Installing the OurGavel autodeploy task...
echo.

schtasks /Query /TN "OurGavel autodeploy" >nul 2>&1
if not errorlevel 1 (
  echo   An existing task was found. Replacing it.
  schtasks /Delete /TN "OurGavel autodeploy" /F >nul 2>&1
)

schtasks /Create ^
  /SC MINUTE /MO 5 ^
  /TN "OurGavel autodeploy" ^
  /TR "\"%~dp0autodeploy.bat\"" ^
  /F
if errorlevel 1 goto failed

echo.
echo   ============================================================
echo    DONE. The task runs every 5 minutes while this PC is on.
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
echo   Running it once now to prove it works...
call "%~dp0autodeploy.bat"
if errorlevel 1 (
  echo   The test run reported a problem. Open autodeploy.log and send Claude the last few lines.
) else (
  echo   Test run OK.
)
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
