@echo off
title NaviGuard Backend - ADMIN DEMO DB (port 4000)
rem Runs the backend against naviguard_admin_demo for this window only.
rem backend\.env is not changed; the main campus_bus database is not used.
set "DATABASE_URL=postgresql://campus:campus_dev@localhost:5432/naviguard_admin_demo?schema=public"
cd /d "%~dp0backend"
npm run dev
pause
