@echo off
chcp 65001 >nul
rem Экспорт презентации в PDF одним кликом: Vedoma.pdf появится рядом с этим файлом.
rem Перед экспортом заполните private.js (пароли, ключи, ссылка на репозиторий).
cd /d "%~dp0"
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER (
  echo Не найден Chrome или Edge. Откройте index.html в браузере и сохраните через Ctrl+P.
  pause
  exit /b 1
)
echo Собираю PDF через %BROWSER% ...
"%BROWSER%" --headless=new --disable-gpu --no-pdf-header-footer --run-all-compositor-stages-before-draw --virtual-time-budget=8000 --print-to-pdf="%~dp0Vedoma.pdf" "file:///%~dp0index.html"
if exist "%~dp0Vedoma.pdf" (
  echo Готово: %~dp0Vedoma.pdf
  start "" "%~dp0Vedoma.pdf"
) else (
  echo Не получилось. Откройте index.html в браузере и сохраните через Ctrl+P.
)
pause
