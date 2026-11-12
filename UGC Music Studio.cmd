@echo off
rem UGC Music Studio - opens the app on the library next to this file (library\).
setlocal
set "HERE=%~dp0"
set "ELECTRON=%HERE%node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
  echo UGC Music Studio cannot start: Electron is not installed in this folder.
  echo Open a terminal in this folder and run: npm install
  pause
  exit /b 1
)
set "MUSIC_LIBRARY_DIR=%HERE%library"
start "" /D "%HERE%" "%ELECTRON%" "%HERE%."
