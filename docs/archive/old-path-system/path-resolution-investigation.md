# Path Resolution System Investigation Report

## Executive Summary

The MCP Debug Server has a UX regression where users must provide absolute paths for scripts, even though the system previously accepted relative paths. This investigation analyzes the complete path resolution system and recommends the best approach to fix this issue while maintaining container support.

## Current System Analysis

### 1. Path Flow Through the System

The path flow through the system is as follows:

1. **MCP Tools** (`src/tools/`)
   - `set_breakpoint` tool receives file path from user
   - `start_debugging` tool receives scriptPath from user
   - Both pass paths to the server methods

2. **Server** (`src/server.ts`)
   - Translates paths using PathTranslator before passing to SessionManager
   - `setBreakpoint()`: Translates file path
   - `startDebugging()`: Translates scriptPath

3. **SessionManager** (`src/session/session-manager.ts`)
   - Receives already-translated paths from server
   - Also creates its own PathTranslator instance for internal use
   - Passes paths to ProxyManager

4. **ProxyManager** (`src/proxy/proxy-manager.ts`)
   - Validates that scriptPath is absolute (line 107-109 in dap-proxy-worker.ts)
   - This validation is the source of the error

### 2. Container vs Non-Container Scenarios

#### Container Scenario
- Environment: `MCP_CONTAINER=true`
- `MCP_HOST_WORKSPACE` defines the host directory mounted in container
- PathTranslator maps:
  - Host absolute paths → Container paths (e.g., `C:\project` → `/workspace`)
  - Relative paths → Container paths (e.g., `src/main.py` → `/workspace/src/main.py`)
  - Container paths → Unchanged (e.g., `/workspace/file.py` → `/workspace/file.py`)

#### Non-Container Scenario
- Environment: `MCP_CONTAINER` not set or `false`
- PathTranslator behavior:
  - Absolute paths → Unchanged
  - Relative paths → Resolved against workspace root
  - Workspace root determined by (in order):
    1. `MCP_WORKSPACE_ROOT` environment variable
    2. Current working directory (`process.cwd()`)

### 3. The Core Issue

The proxy validation at line 107-109 in `dap-proxy-worker.ts` requires absolute paths:

```typescript
if (!path.isAbsolute(config.scriptPath)) {
    throw new Error(`Script path is not absolute: ${config.scriptPath}`);
}
```

However, the PathTranslator in non-container mode now resolves relative paths to absolute paths, but this happens at the server level. The validation was likely added for container support but is too strict for the non-container use case.

### 4. Historical Behavior

Before container support was added:
- Users could provide relative paths
- The debugger would resolve them relative to some base directory
- The exact base directory behavior is unclear from the code history

## Design Decisions

### Base Directory for Relative Paths

In non-container mode, relative paths should be resolved against:
1. **MCP_WORKSPACE_ROOT** if explicitly set
2. **Current working directory** if not set

This provides flexibility:
- Users can run the server from their project root for convenience
- Users can set MCP_WORKSPACE_ROOT for more complex setups
- Clear error messages guide users when paths can't be resolved

### Path Translation Implementation

The current implementation correctly handles path translation at the server level:
1. Server receives user input
2. PathTranslator resolves/translates the path
3. Translated path is passed to SessionManager
4. SessionManager passes to ProxyManager

## Recommended Solution

### Option B: Define a Workspace Root (RECOMMENDED)

This is already implemented! The PathTranslator already:
- Uses MCP_WORKSPACE_ROOT if set
- Falls back to current working directory
- Validates that resolved paths exist
- Provides helpful error messages

**The only change needed is to remove or relax the absolute path validation in the proxy.**

### Implementation Plan

1. **Remove the strict validation** in `dap-proxy-worker.ts`:
   ```typescript
   // Remove or modify this check
   if (!path.isAbsolute(config.scriptPath)) {
       throw new Error(`Script path is not absolute: ${config.scriptPath}`);
   }
   ```

2. **Ensure all paths are translated** before reaching the proxy:
   - ✅ Already done in server.ts for both setBreakpoint and startDebugging
   - ✅ PathTranslator handles all scenarios correctly

3. **Add integration tests** to verify:
   - ✅ Relative paths work in non-container mode
   - ✅ Container path translation works correctly
   - ✅ Error messages are helpful when paths don't exist

## Benefits of Current Approach

1. **Good UX**: Users can use relative paths naturally
2. **Flexible**: Works from any directory with MCP_WORKSPACE_ROOT
3. **Container Compatible**: Full support for Docker/container scenarios
4. **Clear Errors**: Helpful messages when paths can't be resolved
5. **Backward Compatible**: Absolute paths still work as before

## Testing Recommendations

1. **Unit Tests**: ✅ Already comprehensive for PathTranslator
2. **Integration Tests**: Need updates to provide environment dependency
3. **E2E Tests**: Should verify the complete flow with relative paths

## Conclusion

The path resolution system is well-designed and already implements the recommended approach. The only issue is an overly strict validation in the proxy layer that should be removed or relaxed. The PathTranslator correctly handles all path resolution scenarios with good UX and clear error messages.

The system successfully abstracts the complexity of container vs non-container environments while providing users with an intuitive interface for specifying paths.
