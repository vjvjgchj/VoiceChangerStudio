@echo off
set "SCRIPT_DIR=%~dp0"
start "" powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT_DIR%scripts\windows\local_launcher.ps1" -AutoStart
