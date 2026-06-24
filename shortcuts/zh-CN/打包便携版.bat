@echo off
set "PROJECT_ROOT=%~dp0..\..\"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%scripts\windows\prepare_portable.ps1"
pause
