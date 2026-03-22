@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0restart-prod.ps1" %*
