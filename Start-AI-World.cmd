@echo off
cd /d "%~dp0"
set "AI_WORLD_LAUNCHER=%~dp0scripts\launch.mjs"
powershell.exe -NoProfile -WindowStyle Hidden -Command "& node.exe $env:AI_WORLD_LAUNCHER"
