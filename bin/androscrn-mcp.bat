@echo off
setlocal

:: Set working directory to project root
cd /d "%~dp0\.."

:: Check if bundled node exists or fallback to system node
set "NODE_EXE=node"
if exist "%~dp0..\node\node.exe" (
    set "NODE_EXE=%~dp0..\node\node.exe"
)

:: Execute MCP Stdio Server
"%NODE_EXE%" dist/modules/mcp/cli.js %*
