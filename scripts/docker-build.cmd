@echo off
REM Build the Debug MCP Server Docker image

echo Building Debug MCP Server Docker image...
docker build -t mcp-debugger:local .

echo.
echo Image built successfully!
echo To run the server use:
echo   docker run -i --rm mcp-debugger:local
echo.
