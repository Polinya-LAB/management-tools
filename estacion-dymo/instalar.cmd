@echo off
rem Instala la estación de impresión DYMO para el usuario actual (sin permisos de administrador).
chcp 65001 >nul
setlocal

set "ORIGEN=%~dp0"
set "DESTINO=%LOCALAPPDATA%\EstacionDymo"
set "DESCARGAS=%USERPROFILE%\Downloads"

if not exist "%ORIGEN%estacion-dymo.exe" goto :sinexe

set "JSON=%ORIGEN%estacion-dymo.json"
if not exist "%JSON%" set "JSON=%DESCARGAS%\estacion-dymo.json"
if exist "%JSON%" goto :copiar
rem Sin json nuevo: vale el de una instalación anterior (actualizar solo el programa).
set "JSON="
if exist "%DESTINO%\estacion-dymo.json" goto :copiar
goto :sinjson

:copiar
echo Cerrando la estación si estaba en marcha...
taskkill /im estacion-dymo.exe /f >nul 2>&1
timeout /t 2 /nobreak >nul

if not exist "%DESTINO%" mkdir "%DESTINO%"
copy /y "%ORIGEN%estacion-dymo.exe" "%DESTINO%\estacion-dymo.exe" >nul
if errorlevel 1 goto :fallo
if defined JSON copy /y "%JSON%" "%DESTINO%\estacion-dymo.json" >nul
if errorlevel 1 goto :fallo
if exist "%ORIGEN%LEEME.txt" copy /y "%ORIGEN%LEEME.txt" "%DESTINO%\LEEME.txt" >nul

rem Quita la marca de "descargado de Internet" para que Windows no lo bloquee.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath (Join-Path $env:LOCALAPPDATA 'EstacionDymo\estacion-dymo.exe')"

rem Acceso directo en la carpeta Inicio: arranca al iniciar sesión.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = Join-Path $env:LOCALAPPDATA 'EstacionDymo'; $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Estacion DYMO.lnk')); $s.TargetPath = (Join-Path $d 'estacion-dymo.exe'); $s.WorkingDirectory = $d; $s.Description = 'Impresion de etiquetas del laboratorio en la DYMO'; $s.Save()"
if errorlevel 1 goto :fallo

start "" /d "%DESTINO%" "%DESTINO%\estacion-dymo.exe"

echo.
echo Estación instalada en %DESTINO% y en marcha.
echo Arrancará sola cada vez que inicies sesión en Windows.
echo Registro: %DESTINO%\estacion-dymo.log
echo Para comprobarla: Windows+R y escribe
echo   "%DESTINO%\estacion-dymo.exe" --prueba
if not exist "%DESCARGAS%\estacion-dymo.json" goto :fin
echo.
echo IMPORTANTE: borra %DESCARGAS%\estacion-dymo.json
echo Lleva la clave de la estación y ya está copiado donde hace falta.

:fin
echo.
pause
exit /b 0

:sinexe
echo No encuentro estacion-dymo.exe junto a instalar.cmd.
echo Descomprime el zip entero en una carpeta y ejecuta instalar.cmd desde ahí.
goto :error

:sinjson
echo No encuentro estacion-dymo.json ni junto a instalar.cmd ni en %DESCARGAS%.
echo Descárgalo en la página de accesos: "Generar clave de la estación".
goto :error

:fallo
echo No se pudo completar la instalación. Revisa los mensajes de arriba.
goto :error

:error
echo.
pause
exit /b 1
