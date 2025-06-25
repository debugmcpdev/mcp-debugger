# Path Resolution

The MCP debug server uses a simple, predictable path resolution system with two modes: **Host Mode** and **Container Mode**.

## Host Mode (Default)

When running directly on your machine, paths are resolved from the current working directory.

### How It Works

- **Relative paths** are resolved from the current working directory
- **Absolute paths** are used as-is
- No configuration required

### Examples

```bash
# Running from /home/user/myproject
cd /home/user/myproject
node debug-mcp-server
```

Path resolution examples:
```
./src/main.py         → /home/user/myproject/src/main.py
src/main.py           → /home/user/myproject/src/main.py
../shared/utils.py    → /home/user/shared/utils.py
/absolute/path/file.py → /absolute/path/file.py
```

Windows examples:
```
# Running from C:\Users\user\myproject
src\main.py           → C:\Users\user\myproject\src\main.py
..\shared\utils.py    → C:\Users\user\shared\utils.py
C:\absolute\file.py   → C:\absolute\file.py
```

## Container Mode

When running in Docker with `MCP_CONTAINER=true`, all relative paths resolve from the `/workspace` mount point.

### How It Works

- Mount your project to `/workspace`
- All relative paths resolve from `/workspace`
- Absolute paths are not supported (will throw an error)
- Set `MCP_CONTAINER=true` to enable

### Examples

```bash
# Docker run example
docker run -v /home/user/myproject:/workspace \
  -e MCP_CONTAINER=true \
  mcp-debug-server
```

Path resolution in container:
```
src/main.py           → /workspace/src/main.py
./tests/test.py       → /workspace/tests/test.py
../other/file.py      → Error: Path outside workspace
/absolute/path.py     → Error: Absolute paths not supported in container mode
C:\project\file.py    → Error: Absolute paths not supported in container mode
```

## Usage Examples

### Basic Python Debugging (Host Mode)

```python
# Create a debug session
session = create_debug_session(language="python")

# Set breakpoints using relative paths
set_breakpoint(session_id, "src/main.py", 10)
set_breakpoint(session_id, "./tests/test_main.py", 25)

# Start debugging
start_debugging(session_id, "src/main.py")
```

### Container Usage

```yaml
# docker-compose.yml
services:
  mcp-debugger:
    image: mcp-debugger
    environment:
      - MCP_CONTAINER=true
    volumes:
      - ./my-project:/workspace
```

Then use paths relative to your project root:
```python
# These paths work the same whether on host or in container
set_breakpoint(session_id, "src/app.py", 15)
start_debugging(session_id, "main.py")
```

## File Validation

The server validates that files exist before operations:

```
# If file doesn't exist
Error: Could not find file at resolved path: /current/dir/src/main.py

Attempted to resolve relative path: src/main.py
Using workspace root: /current/dir

To fix this:
1. Check the file path is correct
2. Ensure you're running from the right directory
3. Use an absolute path if needed
```

## Note for Existing Users

The path system has been simplified. The following environment variables are no longer used:
- `MCP_WORKSPACE_ROOT` - paths now resolve from current directory
- `MCP_HOST_WORKSPACE` - container paths automatically use `/workspace`

If you were using these variables, simply:
1. Run the server from your project directory (host mode)
2. Mount your project to `/workspace` (container mode)

## Best Practices

1. **Use relative paths** - They work consistently across environments
2. **Run from project root** - Makes relative paths predictable
3. **Container mounting** - Always mount to `/workspace`
4. **Avoid absolute paths** - They reduce portability

## Troubleshooting

### "File not found" Errors

1. Check you're in the correct directory: `pwd` or `cd`
2. Verify the file exists: `ls src/main.py`
3. Try using a different relative path: `./src/main.py` vs `src/main.py`

### Container Path Issues

1. Ensure your volume mount is correct: `-v $(pwd):/workspace`
2. Verify `MCP_CONTAINER=true` is set
3. Check that files exist in the mounted directory

### Cross-Platform Paths

The server handles path separators automatically:
- Use forward slashes (`/`) for portability
- Windows backslashes (`\`) are converted automatically
- Mixed separators work but aren't recommended

## Related Documentation

- [Container Path Translation](./container-path-translation.md) - Details on Docker usage
- [Getting Started](./getting-started.md) - Quick start guide
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions
