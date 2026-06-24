@echo off
set "PROJECT_ROOT=%~dp0..\..\"
start "" powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%PROJECT_ROOT%scripts\windows\local_launcher.ps1"
