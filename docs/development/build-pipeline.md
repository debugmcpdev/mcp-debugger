# Build Pipeline Documentation

## Overview
This document explains the MCP Debugger build pipeline, which scripts require fresh builds, and common pitfalls related to stale build artifacts.

## The `dist/` Directory
The `dist/` directory contains the compiled TypeScript output and is the source of truth for running the MCP server. All runtime execution uses the JavaScript files in this directory, not the TypeScript source files.

## Build Scripts

### Core Build Commands
- **`npm run build`**: Compiles TypeScript to JavaScript in `dist/` directory
  - Automatically runs `prebuild` first (cleans old artifacts)
  - Runs `postbuild` to copy necessary files (proxy bootstrap)
- **`npm run prebuild`**: Removes entire `dist/` directory to prevent stale artifacts
- **`npm run build:clean`**: Explicit clean build (same as `npm run build` due to prebuild)
- **`npm run bundle`**: Creates production bundles after build
  - Main application bundle: `dist/bundle.cjs`
  - Proxy bundle: `dist/proxy/proxy-bundle.cjs`

### Scripts That Require Fresh Builds
The following scripts now include `npm run build` to ensure fresh artifacts:

#### Test Scripts
- **`test`**: Full test suite (unit + integration)
- **`test:integration`**: Integration tests that use the compiled server
- **`test:e2e`**: End-to-end tests that run the actual server
- **`test:e2e:smoke`**: Smoke tests for basic functionality
- **`test:coverage`**: Coverage tests across all test types
- **`test:coverage:quiet`**: Silent coverage run
- **`test:coverage:json`**: JSON output for CI/CD

#### Container Scripts
- **`test:e2e:container`**: Builds fresh Docker image (includes `--no-cache`)
- **`docker-build`**: Builds Docker image (builds inside container)

### Scripts That DON'T Require Builds
These scripts work directly with source files or don't execute code:
- **`test:unit`**: Unit tests run directly on TypeScript source
- **`lint`**: Static analysis of TypeScript source
- **`dev`**: Development mode using ts-node (no compilation)

## Common Pitfalls

### 1. Stale Build Artifacts
**Problem**: Running tests without rebuilding can use outdated code, leading to:
- Tests passing when they should fail
- Tests failing when they should pass
- Confusion about whether changes are working

**Solution**: The build pipeline now automatically runs `npm run build` for all scripts that need it.

### 2. Path Translation in Containers
**Problem**: Container tests expect different path handling than host tests.
- Host mode: Absolute paths are allowed
- Container mode: Absolute paths are rejected with an error

**Solution**: The E2E container test now correctly expects path rejection errors.

### 3. Manual Testing
When manually testing changes:
```bash
# Always rebuild before testing
npm run build

# Or use the test commands that auto-build
npm run test:e2e
```

## Proxy Bundling

The DAP proxy runs as a separate child process and requires its own bundle for container compatibility. During the build process:

1. Main application is bundled as `dist/bundle.cjs`
2. Proxy is bundled as `dist/proxy/proxy-bundle.cjs`

Both bundles include all necessary dependencies, allowing the application to run in minimal containers without node_modules.

The proxy bootstrap (`src/proxy/proxy-bootstrap.js`) automatically detects which version to use based on environment:
- **Production/Container**: Uses the bundled proxy (`proxy-bundle.cjs`)
- **Development**: Uses the unbundled proxy files for easier debugging

### Why Separate Bundles?
- The proxy runs as a **separate child process** for DAP communication
- It needs to be a standalone executable that can be spawned independently
- The bundled version includes all npm dependencies (fs-extra, winston, uuid, etc.)
- This allows the application to run in minimal Alpine containers without installing npm packages

## Docker Builds
Both Dockerfiles build from source inside the container:
- `Dockerfile`: Production multi-stage build
  - Runs `npm run bundle` to create both main and proxy bundles
  - Uses minimal Alpine runtime with only Node.js (no npm)
- `docker/test-ubuntu.dockerfile`: Test environment build

These are not affected by local `dist/` artifacts since they compile inside the container.

## CI/CD Considerations
- GitHub Actions should use scripts that include builds
- Local development can use `npm run dev` to avoid constant rebuilds
- The `prebuild` script ensures no mixing of old and new artifacts

## Best Practices
1. **Use the provided npm scripts** - They handle builds correctly
2. **Don't manually run vitest** without building first
3. **For development**, use `npm run dev` or `npm run test:watch`
4. **For CI/CD**, use the scripts that include builds
5. **When debugging issues**, always check if you have fresh builds

## Troubleshooting

### "Test is using old code"
Run `npm run build` or use a test script that includes building.

### "Container test failing with path errors"
This is now expected behavior - absolute paths are rejected in container mode.

### "Build seems stuck"
The `prebuild` script removes the entire `dist/` directory. If it's locked by a running process, stop all Node processes first.
