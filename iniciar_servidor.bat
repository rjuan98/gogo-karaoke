@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE="
set "USDB_MUSICAS=%~dp0..\ultrasinger\musicas"
set "PASTA_PADRAO=%~dp0musicas"

if exist "%~dp0..\ultrasinger\UltraSinger\.venv\Scripts\python.exe" set "PYTHON_EXE=%~dp0..\ultrasinger\UltraSinger\.venv\Scripts\python.exe"
if not defined PYTHON_EXE if exist "%~dp0..\ultrasinger\python\cpython-3.12.15-windows-x86_64-none\python.exe" set "PYTHON_EXE=%~dp0..\ultrasinger\python\cpython-3.12.15-windows-x86_64-none\python.exe"

if not defined PYTHON_EXE (
  where py >nul 2>nul
  if not errorlevel 1 (
    set "PYTHON_EXE=py"
    set "PYTHON_ARGS=-3"
  )
)

if not defined PYTHON_EXE (
  where python >nul 2>nul
  if not errorlevel 1 set "PYTHON_EXE=python"
)

if not defined PYTHON_EXE (
  echo Python 3 nao foi encontrado. Instale o Python 3 ou o UltraSinger e tente de novo.
  pause
  exit /b 1
)

echo Iniciando o servidor do gogo para acesso pelo tunel HTTPS...
echo Deixe esta janela aberta enquanto as festas estiverem usando o catalogo.

if not "%*"=="" (
  "%PYTHON_EXE%" %PYTHON_ARGS% servir.py --sem-https %*
) else if exist "%USDB_MUSICAS%" (
  "%PYTHON_EXE%" %PYTHON_ARGS% servir.py --sem-https --musicas "%USDB_MUSICAS%"
) else (
  "%PYTHON_EXE%" %PYTHON_ARGS% servir.py --sem-https --musicas "%PASTA_PADRAO%"
)
pause
