@echo off
rem Starts NaviGuard backend and frontend in two separate windows.
start "NaviGuard Backend" cmd /k ""%~dp0start-backend.bat""
start "NaviGuard Frontend" cmd /k ""%~dp0start-frontend.bat""
echo Backend:  http://localhost:4000
echo Frontend: http://localhost:5173
