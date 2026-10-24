@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python nao foi encontrado. Instale o Python 3 e tente de novo.
  pause
  exit /b 1
)

echo Iniciando o servidor do gogo para acesso pelo tunel HTTPS...
echo Deixe esta janela aberta enquanto as festas estiverem usando o catalogo.
python servir.py --sem-https %*
pause
