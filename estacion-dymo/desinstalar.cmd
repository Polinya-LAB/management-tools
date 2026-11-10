@echo off
rem Quita la estación de impresión DYMO: la para, borra el acceso directo de Inicio y su carpeta.
chcp 65001 >nul
setlocal

set "DESTINO=%LOCALAPPDATA%\EstacionDymo"

echo Parando la estación...
taskkill /im estacion-dymo.exe /f >nul 2>&1
timeout /t 2 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Startup')) 'Estacion DYMO.lnk') -ErrorAction SilentlyContinue"

if exist "%DESTINO%" rmdir /s /q "%DESTINO%"
if exist "%DESTINO%" goto :fallo

echo Estación desinstalada. La clave sigue valiendo hasta que generes otra en la página de accesos.
echo.
pause
exit /b 0

:fallo
echo No se pudo borrar %DESTINO%: cierra lo que tengas abierto de esa carpeta y vuelve a intentarlo.
echo.
pause
exit /b 1
