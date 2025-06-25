# Docker Path Translation Fixes Report

## Issues Discovered

### 1. Missing Container Environment Variable in Runtime Stage
**Problem**: The `MCP_CONTAINER=true` environment variable was only set in the builder stage of the Dockerfile, not in the final runtime image. Environment variables don't automatically carry over between Docker build stages.

**Impact**: The path translator wasn't activated in the containerized environment, requiring users to:
- Use full container paths (e.g., `/workspace/examples/python/fibonacci.py`)
- Manually specify the environment variable in Docker run commands

**Root Cause**: Multi-stage Docker build where ENV was only declared in the first stage.

### 2. Missing Host Workspace Configuration
**Problem**: The `MCP_HOST_WORKSPACE` environment variable wasn't being passed to the container, preventing automatic path translation from host paths to container paths.

**Impact**: 
- Relative paths weren't being resolved correctly
- Windows absolute paths weren't being translated
- Users had to use container-specific paths

## Fixes Implemented

### 1. Dockerfile Update
Added `ENV MCP_CONTAINER=true` to the runtime stage:

```dockerfile
# Stage 2: Create minimal runtime image
FROM python:3.11-alpine

WORKDIR /app

# Set container marker for runtime
ENV MCP_CONTAINER=true  # <-- Added this line

# Install only Node.js runtime (no npm) and Python deps
RUN apk add --no-cache nodejs && \
    pip3 install --no-cache-dir debugpy>=1.8.14
```

### 2. MCP Configuration Update
Updated the Docker args to include the host workspace environment variable:

```json
"args": [
  "run",
  "--rm",
  "-i",
  "-e",
"MCP_HOST_WORKSPACE=C:/Users/user/path/to/project/debug-mcp-server",
  "-v",
"C:/Users/user/path/to/project/debug-mcp-server:/workspace:rw",
  "-v",
"C:/Users/user/AppData/Local/Temp:/tmp:rw",
  "mcp-debugger:local",
  "stdio",
  "--log-level",
  "debug",
  "--log-file",
  "/tmp/mcp-debugger-docker.log"
]
```

## Testing Results

### Successful Path Translation Tests
1. **Relative Path Translation**: 
   - Input: `examples/python/fibonacci.py`
   - Output: `/workspace/examples/python/fibonacci.py` ✓

2. **Windows Absolute Path Translation**:
   - Input: `C:/Users/user/path/to/project/debug-mcp-server/examples/python/fibonacci.py`
   - Output: `/workspace/examples/python/fibonacci.py` ✓

### Outstanding Issue: Proxy Initialization Error
During testing, encountered an error with the proxy bootstrap script:
```
[Bootstrap] ERROR during dynamic import or execution of dap-proxy.js: 
Error: Cannot find module '//app/dist/proxy/dap-proxy-entry.js'
```

**Suspected Cause**: The `MCP_SERVER_CWD` is being set to `/` which causes double slashes in the path construction.

## Benefits of the Fixes

1. **Simplified Usage**: Users can now use familiar paths instead of container-specific paths
2. **Cross-Platform Compatibility**: Windows paths are automatically translated
3. **Better Developer Experience**: Relative paths work as expected
4. **Reduced Configuration Complexity**: No need to manually set `MCP_CONTAINER=true` in Docker commands

## Next Steps

1. Fix the proxy initialization error related to `MCP_SERVER_CWD`
2. Complete comprehensive testing of all debugging tools
3. Update documentation to reflect the simplified usage

## Best Practices Learned

1. **Always set environment variables in the correct Docker stage**: In multi-stage builds, ENV directives must be in the final stage
2. **Make static configuration part of the image**: Constants like `MCP_CONTAINER=true` should be baked into the image
3. **Keep dynamic configuration as runtime parameters**: User-specific paths like `MCP_HOST_WORKSPACE` should remain as runtime arguments
4. **Test path handling thoroughly**: Path translation is critical for cross-platform containerized applications
