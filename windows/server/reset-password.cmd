@echo off
rem Forgotten password: sets a temporary one. Right-click, Run as administrator.
set /p U=Username: 
"%~dp0..\python\python.exe" "%~dp0ops_win.py" reset-password "%U%"
pause
