# Container Path Translation

When running the MCP debug server in Docker, path handling is automatic and simple.

## Quick Start

```bash
# Run with Docker
docker run -v /your/project:/workspace \
  -e MCP_CONTAINER=true \
  mcp-debug-server

# Run with docker-compose
docker-compose up
```

That's it! Your project files are now accessible in the container.

## How It Works

1. **Mount your project** to `/workspace` in the container
2. **Set** `MCP_CONTAINER=true` environment variable
3. **Use relative paths** - they automatically resolve from `/workspace`

## Examples

### Docker Run

```bash
# Linux/macOS
docker run -it \
  -v $(pwd):/workspace \
  -e MCP_CONTAINER=true \
  -p 3000:3000 \
  mcp-debugger

# Windows PowerShell
docker run -it \
  -v ${PWD}:/workspace \
  -e MCP_CONTAINER=true \
  -p 3000:3000 \
  mcp-debugger
```

### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'
services:
  mcp-debugger:
    image: mcp-debugger
    environment:
      - MCP_CONTAINER=true
    volumes:
      - .:/workspace
    ports:
      - "3000:3000"
```

### Using the Debugger

Once running, use paths relative to your project root:

```python
# These paths work automatically
set_breakpoint(session_id, "src/main.py", 10)
set_breakpoint(session_id, "tests/test_app.py", 25)
start_debugging(session_id, "app.py")
```

## Path Resolution Examples

When your project is mounted at `/workspace`:

| Your Path | Resolves To | Notes |
|-----------|-------------|-------|
| `main.py` | `/workspace/main.py` | Simple relative path |
| `src/app.py` | `/workspace/src/app.py` | Nested relative path |
| `./tests/test.py` | `/workspace/tests/test.py` | Explicit relative path |
| `/workspace/file.py` | `/workspace/file.py` | Already a container path |
| `/other/path.py` | Error | Outside workspace |
| `C:\project\file.py` | Error | Absolute paths not supported |

## Common Scenarios

### Development Workflow

```bash
# Navigate to your project
cd /path/to/my-project

# Run the debugger
docker run -v $(pwd):/workspace -e MCP_CONTAINER=true mcp-debugger

# Your project structure is preserved
# my-project/
#   ├── src/
#   │   └── main.py
#   └── tests/
#       └── test_main.py
```

### Multi-Stage Debugging

```yaml
# docker-compose.yml for complex projects
version: '3.8'
services:
  debugger:
    image: mcp-debugger
    environment:
      - MCP_CONTAINER=true
    volumes:
      - ./backend:/workspace
    
  frontend:
    image: node:18
    volumes:
      - ./frontend:/app
```

## Note for Existing Users

The container path system has been simplified:
- `MCP_HOST_WORKSPACE` is no longer needed - just mount to `/workspace`
- Complex path mapping configuration has been removed
- The system automatically handles all path translation

To migrate:
1. Remove `MCP_HOST_WORKSPACE` from your environment
2. Ensure you're mounting to `/workspace`
3. Keep using `MCP_CONTAINER=true`

## Troubleshooting

### "File not found" Errors

This usually means the file isn't in your mounted volume:

```bash
# Check what's mounted
docker exec <container-id> ls -la /workspace

# Verify your mount is correct
docker inspect <container-id> | grep -A 5 Mounts
```

### "Path not accessible" Errors

This means you're trying to access a file outside `/workspace`:

```
Error: Path '/etc/passwd' is not accessible in the container.
Only files under the mounted workspace are accessible.
```

Solution: Only debug files within your mounted project directory.

### Windows Path Issues

On Windows, ensure you're using the correct mount syntax:

```powershell
# PowerShell (recommended)
docker run -v ${PWD}:/workspace ...

# Command Prompt
docker run -v %cd%:/workspace ...

# Git Bash
docker run -v /$(pwd):/workspace ...
```

## Best Practices

1. **Always mount to `/workspace`** - This is the standard location
2. **Use relative paths** - They work across all environments
3. **One project per container** - Keep debugging sessions isolated
4. **Check mounts first** - Most issues are mounting problems

## Advanced Usage

### Custom Dockerfiles

```dockerfile
FROM mcp-debugger:latest

# Your project might have dependencies
WORKDIR /workspace
COPY requirements.txt .
RUN pip install -r requirements.txt

# MCP_CONTAINER is already set in the base image
# Just mount your project to /workspace when running
```

### Development vs Production

```yaml
# docker-compose.override.yml (for development)
version: '3.8'
services:
  debugger:
    environment:
      - LOG_LEVEL=debug
    volumes:
      - .:/workspace
      - ./logs:/var/log/debugger
```

## Related Documentation

- [Path Resolution](./path-resolution.md) - General path handling
- [Docker Support](./docker-support.md) - Docker configuration details
- [Getting Started](./getting-started.md) - Quick start guide
