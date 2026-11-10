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
rem Espera hasta 10 s a que se cierre del todo: Windows no deja sustituir un programa en marcha.
set /a ESPERA=0
:esperar
tasklist /fi "imagename eq estacion-dymo.exe" 2>nul | find /i "estacion-dymo.exe" >nul
if errorlevel 1 goto :cerrada
set /a ESPERA+=1
if %ESPERA% geq 10 goto :sigue
timeout /t 1 /nobreak >nul
goto :esperar
:cerrada

if not exist "%DESTINO%" mkdir "%DESTINO%"
rem La versión anterior se aparta antes de copiar: renombrar funciona aunque el antivirus la tenga abierta.
if exist "%DESTINO%\estacion-dymo.old.exe" del /f /q "%DESTINO%\estacion-dymo.old.exe" >nul 2>&1
if exist "%DESTINO%\estacion-dymo.exe" attrib -r "%DESTINO%\estacion-dymo.exe" >nul 2>&1
if exist "%DESTINO%\estacion-dymo.exe" ren "%DESTINO%\estacion-dymo.exe" estacion-dymo.old.exe >nul 2>&1
echo Copiando el programa...
copy /y "%ORIGEN%estacion-dymo.exe" "%DESTINO%\estacion-dymo.exe" >nul
if errorlevel 1 goto :falloexe
if exist "%DESTINO%\estacion-dymo.old.exe" del /f /q "%DESTINO%\estacion-dymo.old.exe" >nul 2>&1
if not defined JSON goto :sinjsonnuevo
echo Copiando la configuración...
if exist "%DESTINO%\estacion-dymo.json" attrib -r "%DESTINO%\estacion-dymo.json" >nul 2>&1
copy /y "%JSON%" "%DESTINO%\estacion-dymo.json" >nul
if errorlevel 1 goto :fallojson
:sinjsonnuevo
if exist "%ORIGEN%LEEME.txt" copy /y "%ORIGEN%LEEME.txt" "%DESTINO%\LEEME.txt" >nul

rem Quita la marca de "descargado de Internet" para que Windows no lo bloquee.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath (Join-Path $env:LOCALAPPDATA 'EstacionDymo\estacion-dymo.exe')"

rem Acceso directo en la carpeta Inicio: arranca al iniciar sesión.
rem La estación arranca en una consola oculta (iniciar.vbs): así curl.exe y PowerShell, que lanza ella, no abren
rem ventanas al ejecutarse.
> "%DESTINO%\iniciar.vbs" echo Set s = CreateObject("WScript.Shell")
>> "%DESTINO%\iniciar.vbs" echo d = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
>> "%DESTINO%\iniciar.vbs" echo s.CurrentDirectory = d
>> "%DESTINO%\iniciar.vbs" echo s.Run Chr(34) ^& d ^& "\estacion-dymo.exe" ^& Chr(34), 0, False
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = Join-Path $env:LOCALAPPDATA 'EstacionDymo'; $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Estacion DYMO.lnk')); $s.TargetPath = (Join-Path $env:WINDIR 'System32\wscript.exe'); $s.Arguments = '\"' + (Join-Path $d 'iniciar.vbs') + '\"'; $s.WorkingDirectory = $d; $s.Description = 'Impresion de etiquetas del laboratorio en la DYMO'; $s.Save()"
if errorlevel 1 goto :fallo

start "" "%WINDIR%\System32\wscript.exe" "%DESTINO%\iniciar.vbs"

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

:sigue
echo.
echo La estación anterior sigue en marcha y Windows no deja cerrarla desde aquí
echo (suele pasar si se abrió como administrador). Ciérrala así y vuelve a ejecutar instalar.cmd:
echo   1. Ctrl+Mayús+Esc para abrir el Administrador de tareas, pestaña Detalles.
echo   2. Clic derecho en cada estacion-dymo.exe y "Finalizar tarea".
echo Si no te deja, reinicia el ordenador y ejecuta instalar.cmd nada más entrar.
goto :error

:falloexe
echo.
echo No se pudo copiar estacion-dymo.exe a %DESTINO%.
echo Suele ser el antivirus revisando el programa nuevo: espera un minuto y vuelve a ejecutar instalar.cmd.
echo Si se repite, haz una captura de esta ventana.
goto :error

:fallojson
echo.
echo No se pudo copiar estacion-dymo.json a %DESTINO%. Haz una captura de esta ventana.
goto :error

:fallo
echo No se pudo completar la instalación. Revisa los mensajes de arriba.
goto :error

:error
echo.
pause
exit /b 1
