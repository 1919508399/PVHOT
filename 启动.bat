@echo off
chcp 65001 >nul
REM 光伏 HOT · 一键启动（拉取最新数据 + 启动本地服务器 + 打开浏览器）
cd /d "%~dp0"
set NODE=C:\Users\HUASUN\.workbuddy\binaries\node\versions\22.22.2\node.exe
set PY=C:\Users\HUASUN\.workbuddy\binaries\python\versions\3.13.12\python.exe
set PORT=8099

echo.
echo  ============================================
echo   光伏 HOT · PV 行业动态聚合
echo  ============================================
echo.
echo  [1/3] 抓取真实光伏 RSS 并翻译成中文（约 20-30 秒）...
"%NODE%" fetch_pv_news.js
if errorlevel 1 (
  echo    ! 抓取失败，将使用本地已有 data.json 继续
)
echo.
echo  [2/3] 启动本地服务器 :%PORT% ...
start "光伏HOT-服务器-关闭此窗口即停止" /min "%PY%" -m http.server %PORT% --bind 127.0.0.1
timeout /t 2 /nobreak >nul
echo.
echo  [3/3] 打开浏览器 ...
start "" "http://127.0.0.1:%PORT%/index.html"
echo.
echo  ✅ 已打开 http://127.0.0.1:%PORT%/index.html
echo     关闭 "光伏HOT-服务器" 窗口即可停止。
echo     不想每次联网？直接双击 index.html 也能看（用内嵌数据）。
echo.
pause
