# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] - 2025-06-24

### Added

- **Dynamic Tool Documentation**: Tool descriptions now adapt to runtime environment (host vs container), helping LLMs understand path requirements without trial and error
- **Structured JSON Logging**: All debugging operations emit structured JSON logs for visualization and monitoring
  - Tool invocations with sanitized parameters
  - Debug state changes (paused/running/stopped)
  - Breakpoint lifecycle events
  - Variable inspections with truncated values
- **Comprehensive Smoke Tests**: Added SSE and container transport smoke tests to complement existing stdio tests
  - Tests for all transport mechanisms (stdio, SSE, containerized)
  - Cross-platform volume mounting verification
  - Smart Docker image caching for faster tests
- **Path Translation System**: Improved dependency injection for container/host path flexibility
- **Test Utilities**: Enhanced test helpers for smoke tests including Docker utilities

### Changed

- **Docker Image Optimization**: Reduced image size by 64% (670MB → 240MB), improving deployment size and container startup time
  - Switched to Alpine Linux base image
  - Implemented esbuild bundling for JavaScript dependencies
  - Optimized multi-stage build process
- **Container Proxy Bundling**: Fixed proxy dependency issues in Alpine environments
- **Parameter Validation**: Improved validation with proper MCP error responses
- **Error Messages**: Enhanced error messages with clearer context for debugging

### Fixed

- Container proxy dependency resolution in Alpine Linux environments
- Test mocking issues in dynamic tool documentation
- Path handling edge cases in container mode
- Various test stability improvements

## [0.9.0] - 2025-01-09

### Breaking Changes

- SessionManager constructor changed to use dependency injection (backward compatibility maintained but deprecated)
- Removed ActiveDebugRun type in favor of ProxyManager architecture

### Added

- **Vitest Migration**: Complete migration from Jest to Vitest for native ESM support (10-20x faster test execution)
- **Dependency Injection**: Comprehensive dependency injection system with factories for all major components
- **Error Handling**: Centralized error messages module with user-friendly timeout explanations
- **Proxy Architecture**: Three-layer proxy architecture (core/worker/entry) for better separation of concerns
- **Functional Core**: Pure functional DAP handling logic with no side effects
- **Documentation**:
  - Comprehensive developer documentation in `docs/development/`
  - Architecture diagrams and patterns guide in `docs/architecture/` and `docs/patterns/`
  - LLM collaboration journey documentation
- **Test Utilities**: Extensive test helper functions and mock factories

### Changed

- **Test Coverage**: Increased from <20% to >90% with 657 passing tests (up from 355)
- **SessionManager**: Reduced complexity by 40% through ProxyManager delegation
- **Code Organization**: Improved separation of concerns with clear module boundaries
- **Event Management**: Proper lifecycle management with cleanup on session close

### Fixed

- Memory leak in event handlers (proper cleanup in closeSession)
- Race condition in dry run (replaced hardcoded timeout with event-based coordination)
- Unhandled promise rejections in tests
- Enhanced timeout error messages for better debugging

### Removed

- Jest test runner and all Jest-related dependencies
- Obsolete test files and configurations
- python-utils.ts (functionality integrated elsewhere)
- Various deprecated provider and protocol files

## [0.1.0] - 2025-05-27

### Added

- Initial public release of `debug-mcp-server`.
- Core functionality for Python debugging using the Debug Adapter Protocol (DAP) via `debugpy`.
- MCP server implementation with tools for:
    - Creating and managing debug sessions (`create_debug_session`, `list_debug_sessions`, `close_debug_session`).
    - Debug actions: `set_breakpoint`, `start_debugging`, `step_over`, `step_into`, `step_out`, `continue_execution`.
    - State inspection: `get_stack_trace`, `get_scopes`, `get_variables`.
- Support for both STDIN/STDOUT and HTTP transport for MCP communication.
- Basic CLI to start the server with transport and logging options.
- Python "launcher" package (`debug-mcp-server-launcher`) for PyPI, to aid users in running the server and ensuring `debugpy` is available.
- Dockerfile for building and running the server in a containerized environment, including OCI labels.
- GitHub Actions CI setup for:
    - Building and testing on Ubuntu and Windows.
    - Linting with ESLint.
    - Publishing Docker image to Docker Hub on version tags.
    - Publishing Python launcher package to PyPI on version tags.
- Project structure including:
    - `LICENSE` (MIT).
    - `CONTRIBUTING.md` (basic template).
    - GitHub issue and pull request templates.
    - `README.md` with quick start, features, and usage instructions.
    - `docs/` directory with initial documentation (`quickstart.md`).
    - `examples/` directory with:
        - `python_simple_swap/`: A buggy Python script and a demo script showing how to debug it using MCP tools.
        - `agent_demo.py`: A minimal example of an LLM agent loop interacting with the server.
- Unit and integration tests for core functionality. (E2E tests for HTTP transport are currently skipped due to environment complexities).
- `pyproject.toml` for the Python launcher and `package.json` for the Node.js server.

### Changed

- Build output directory standardized to `dist/`.

### Known Issues

- E2E tests for HTTP transport (`tests/e2e/debugpy-connection.test.ts`) are temporarily skipped due to challenges with JavaScript environment setup (fetch/ReadableStream polyfills in Jest/JSDOM). These will be revisited.
- Placeholder URLs and names (e.g., for repository, Docker Hub user, author) in `package.json`, `pyproject.toml`, `Dockerfile`, `README.md`, and example scripts need to be updated with actual project details.
