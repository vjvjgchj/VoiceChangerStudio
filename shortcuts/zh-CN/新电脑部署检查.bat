@echo off
set "PROJECT_ROOT=%~dp0..\..\"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%scripts\windows\setup_new_pc.ps1"
pause
