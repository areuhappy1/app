@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo pH Analyzer v5 - Windows EXE Builder
echo ==========================================
echo.

where py >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python launcher "py" was not found.
    echo Install Python 3.12 and try again.
    pause
    exit /b 1
)

echo [1/4] Python:
py --version
if errorlevel 1 (
    echo ERROR: Python is not working.
    pause
    exit /b 1
)

echo.
echo [2/4] Installing packages...
py -m pip install --upgrade pip
if errorlevel 1 (
    echo ERROR: pip upgrade failed.
    pause
    exit /b 1
)

py -m pip install opencv-python numpy pyinstaller
if errorlevel 1 (
    echo ERROR: package installation failed.
    pause
    exit /b 1
)

echo.
echo [3/4] Building EXE...
py -m PyInstaller --noconfirm --clean --onefile --windowed --name pH_Analyzer_v5 "ph_color_analyzer_v5.py"
if errorlevel 1 (
    echo ERROR: PyInstaller build failed.
    pause
    exit /b 1
)

if not exist "%~dp0dist\pH_Analyzer_v5.exe" (
    echo ERROR: EXE was not created.
    pause
    exit /b 1
)

echo.
echo [4/4] SUCCESS
echo EXE:
echo %~dp0dist\pH_Analyzer_v5.exe
echo.
start "" "%~dp0dist"
pause
