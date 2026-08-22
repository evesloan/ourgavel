' OurGavel — silent launcher for autodeploy.bat.
'
' The scheduled task used to run autodeploy.bat directly, so cmd.exe opened a
' console window every five minutes, all day, on Eve's screen. Nothing was wrong
' with it -- that is just what schtasks does when the action is a .bat.
'
' wscript.exe runs this file with no window of its own, and Shell.Run with a
' window style of 0 starts the batch hidden too. Nothing flashes.
'
' bWaitOnReturn is True on purpose: the task should stay "running" for as long as
' the deploy actually takes, so Task Scheduler's own "do not start a new instance"
' rule applies, and so the exit code below is the batch file's real one. A run that
' ends BLOCKED shows up as a failed task instead of a silent success.
Option Explicit
Dim sh, here, rc
Set sh = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
rc = sh.Run("""" & here & "autodeploy.bat""", 0, True)
WScript.Quit rc
