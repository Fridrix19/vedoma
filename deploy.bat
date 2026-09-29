@echo off
chcp 65001 >nul
rem Выкладка UniFlow на сервер одной командой: deploy.bat
rem Упаковывает проект (без node_modules, data, .env), загружает на VPS и пересобирает контейнер.
rem .env на сервере НЕ перезаписывается — ключи и токены там свои.
cd /d "%~dp0"
set SERVER=root@5.35.85.41
set DOMAIN=uniflow.betatestbyfridrix.ru

echo [1/3] Упаковываю проект...
tar -czf "%TEMP%\uniflow-deploy.tgz" --exclude=node_modules --exclude=dist --exclude=dist-demo --exclude=data --exclude=.env --exclude=*.zip --exclude=.git --exclude=presentation .
if errorlevel 1 goto fail

echo [2/3] Загружаю на сервер (попросит пароль root)...
scp "%TEMP%\uniflow-deploy.tgz" %SERVER%:/root/uniflow-deploy.tgz
if errorlevel 1 goto fail

echo [3/3] Пересобираю на сервере (ещё раз пароль)...
ssh %SERVER% "cd /root/uniflow-app && tar -xzf /root/uniflow-deploy.tgz && docker compose --profile https up -d --build && sleep 5 && curl -s https://%DOMAIN%/api/health"
if errorlevel 1 goto fail

echo.
echo Готово: https://%DOMAIN%
pause
exit /b 0

:fail
echo.
echo Ошибка — выкладка остановлена.
pause
exit /b 1
