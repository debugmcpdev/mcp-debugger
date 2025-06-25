# Archived: Old Path System Documentation

This directory contains documentation for the old, complex path resolution system that was removed in the path simplification update.

## Why These Files Were Archived

The MCP debug server previously used a complex path translation system with configurable environment variables:
- `MCP_WORKSPACE_ROOT` - for setting custom workspace roots
- `MCP_HOST_WORKSPACE` - for container-to-host path mapping

This system has been replaced with a simpler two-mode approach:
- **Host mode**: Paths resolve from current working directory
- **Container mode**: Paths resolve from `/workspace` mount

## Archived Files

- `container-fix-summary.md` - Summary of container path fixes
- `container-path-translation-fix-status.md` - Status of path translation fixes
- `container-path-translation-fix.md` - Details of path translation implementation
- `docker-path-translation-fixes.md` - Docker-specific path fixes
- `path-resolution-fix-summary.md` - Summary of path resolution changes
- `path-resolution-investigation.md` - Investigation into path resolution issues

## Current Documentation

For the current path resolution system, see:
- [`/docs/path-resolution.md`](../../path-resolution.md)
- [`/docs/container-path-translation.md`](../../container-path-translation.md)

These files are preserved for historical reference only.
