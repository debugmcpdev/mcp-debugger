# E2E Smoke Tests

This directory contains end-to-end smoke tests that verify the MCP debugger server works correctly across different transport mechanisms and deployment scenarios.

## Test Files

### 1. `mcp-server-smoke.test.ts` (Existing)
- Tests stdio transport
- Verifies basic debugging workflow
- Tests spawning from different working directories

### 2. `mcp-server-smoke-sse.test.ts` (New)
- Tests SSE (Server-Sent Events) transport
- Uses dynamic port allocation to avoid conflicts
- Verifies HTTP/SSE connection and debugging workflow
- Tests spawning from different working directories

### 3. `mcp-server-smoke-container.test.ts` (New)
- Tests containerized deployment
- Verifies Docker setup works end-to-end
- Tests path translation (host paths → container paths)
- Includes Docker availability check with graceful skip
- Tests volume mounting and environment variable handling

### 4. `smoke-test-utils.ts` (New)
- Shared utilities for all smoke tests
- Common debug sequence execution
- Docker and SSE helper functions
- Cross-platform compatibility utilities

## Running the Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run only smoke tests
npm run test:e2e:smoke

# Run individual smoke test
npx vitest run tests/e2e/mcp-server-smoke-sse.test.ts
npx vitest run tests/e2e/mcp-server-smoke-container.test.ts
```

## Prerequisites

### For SSE Tests
- No special requirements (uses dynamic port allocation)

### For Container Tests
- Docker must be installed and running
- Tests will skip automatically if Docker is not available

## Test Coverage

The smoke tests provide comprehensive coverage of:
1. **Transport Methods**: stdio, SSE, containerized stdio
2. **Path Resolution**: Different working directories, path translation
3. **Environment Handling**: Container environment variables, volume mounts
4. **Error Scenarios**: Proper cleanup on failure, detailed error logging

## Key Features

- **Consistent Structure**: All tests follow the same pattern for easy maintenance
- **Robust Cleanup**: Ensures processes and containers are cleaned up even on failure
- **Detailed Logging**: Comprehensive logging for debugging test failures
- **Skip Conditions**: Graceful handling when prerequisites aren't met
- **Performance Optimized**: Docker image caching, dynamic port allocation
- **Cross-Platform**: Works on Windows, Linux, and macOS

## Troubleshooting

### SSE Test Failures
- Check if port is already in use (tests use dynamic ports to minimize this)
- Verify the server health endpoint is responding
- Check server logs for startup errors

### Container Test Failures
- Ensure Docker is installed: `docker --version`
- Check Docker is running: `docker ps`
- Verify Docker image builds successfully: `npm run docker-build`
- Check container logs (automatically captured on failure)

### Common Issues
- **Timeout errors**: Increase TEST_TIMEOUT if needed
- **Path not found**: Ensure the project is built (`npm run build`)
- **Permission errors**: May need elevated permissions for Docker
