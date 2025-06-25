# Path Flexibility Feature Audit

## Executive Summary

This audit identifies ALL touchpoints of the path flexibility system that must be removed to implement the simplified approach:
- **Host mode**: Relative paths resolved from server's CWD, absolute paths supported
- **Container mode**: Relative paths resolved from `/workspace`, no absolute paths

## Files to Modify

### Core Implementation Files

#### `src/utils/path-translator.ts`
- **Action**: Simplify entire implementation
- **Current**: Complex path translation with custom workspace roots and host/container mapping
- **Target**: Simple path resolution (CWD for host, /workspace for container)
- **Lines to remove**: 
  - All `MCP_WORKSPACE_ROOT` logic in `getWorkspaceRoot()` method
  - All `MCP_HOST_WORKSPACE` logic in container mode
  - Complex path translation in `translatePath()` method
- **Lines to keep**: Basic container detection via `MCP_CONTAINER`

#### `src/server.ts`
- **Lines 15**: `import { PathTranslator } from './utils/path-translator.js';`
- **Lines 20-21**: Remove `pathTranslator?: PathTranslator;` from interface
- **Lines 35**: Remove `private pathTranslator: PathTranslator;`
- **Lines 89**: Remove PathTranslator instantiation
- **Action**: Remove PathTranslator dependency, use simple path resolution

#### `src/session/session-manager.ts`
- **Lines 4**: `import { PathTranslator } from '../utils/path-translator.js';`
- **Lines 26**: Remove `private pathTranslator: PathTranslator;`
- **Lines 42**: Remove PathTranslator instantiation
- **Lines 295**: Remove `this.pathTranslator.translatePath()` call in `setBreakpoint`
- **Action**: Replace with simple path resolution logic

### Test Files to Update/Remove

#### `tests/unit/utils/path-translator.test.ts`
- **Action**: Completely rewrite for simplified logic
- **Current**: 500+ lines testing complex path translation scenarios
- **Target**: ~50 lines testing simple container vs host path resolution

#### `tests/unit/utils/path-translator-container-bug.test.ts`
- **Action**: Delete entire file
- **Reason**: Tests complex container path translation bugs that won't exist

#### `tests/integration/path-resolution.test.ts`
- **Lines 24**: Remove `MCP_WORKSPACE_ROOT` test
- **Lines 44-59**: Remove explicit workspace root test case
- **Action**: Simplify to basic relative/absolute path tests

#### `tests/integration/container-paths.test.ts`
- **Lines 15-45**: Remove PathTranslator instantiation tests
- **Lines 70-120**: Remove MCP_HOST_WORKSPACE validation tests
- **Action**: Simplify to basic container path behavior tests

#### `tests/e2e/container-path-translation.test.ts`
- **Action**: Simplify significantly
- **Remove**: All MCP_HOST_WORKSPACE test scenarios
- **Keep**: Basic container vs host path resolution verification

### Documentation to Update

#### `README.md`
- **Section**: "Path Configuration" (if exists)
- **Action**: Remove complex path configuration instructions
- **Replace**: Simple explanation of CWD vs /workspace behavior

#### `docs/path-resolution.md`
- **Action**: Complete rewrite
- **Remove**: All MCP_WORKSPACE_ROOT and MCP_HOST_WORKSPACE documentation
- **Replace**: Simple 2-mode explanation

#### `docs/container-path-translation.md`
- **Action**: Simplify dramatically
- **Remove**: MCP_HOST_WORKSPACE configuration instructions
- **Keep**: Basic container mode explanation

#### `docs/docker-path-translation-fixes.md`
- **Action**: Archive or delete
- **Reason**: Documents complex features being removed

#### `docs/path-resolution-fix-summary.md`
- **Action**: Archive or delete
- **Reason**: Documents complex path resolution features

#### `docs/path-resolution-investigation.md`
- **Action**: Archive or delete
- **Reason**: Investigation of complex features being removed

#### `docs/container-path-translation-fix-status.md`
- **Action**: Delete
- **Reason**: Status document for complex features being removed

#### `docs/container-path-translation-fix.md`
- **Action**: Delete
- **Reason**: Fix documentation for complex features being removed

#### `docs/container-fix-summary.md`
- **Action**: Delete
- **Reason**: Summary of complex container fixes being removed

### Configuration Changes

#### `Dockerfile`
- **Line 25**: Keep `ENV MCP_CONTAINER=true`
- **Action**: No changes needed - still need container detection

#### `check-env.cmd`
- **Lines 3-4**: Remove `MCP_HOST_WORKSPACE` and `MCP_WORKSPACE_ROOT` echo statements
- **Action**: Remove environment variable checks for deleted features

### Files to Delete Entirely

#### Temporary/Debug Files
- `src/utils/path-translator-fix.ts` - Duplicate implementation file
- `test-path-bug.js` - Debugging artifact
- `test-path-substring.js` - Debugging artifact  
- `test-path-translator-logic.js` - Debugging artifact
- `test-container-path-detection.js` - Debugging artifact
- `test-container-proxy.cjs` - Debugging artifact (if path-related)

#### Generated/Distribution Files
- `dist/utils/path-translator-fix.js` - Will be regenerated
- `coverage/src/utils/path-translator-fix.ts.html` - Will be regenerated
- All path-translator related files in `dist/` and `coverage/` directories

#### Log Files (if not needed)
- Any log files containing path translation debugging

## Environment Variables Impact

### Variables to Remove
- `MCP_WORKSPACE_ROOT` - No longer needed
- `MCP_HOST_WORKSPACE` - No longer needed

### Variables to Keep
- `MCP_CONTAINER` - Still needed for mode detection

## Implementation Plan

### Phase 1: Core Simplification
1. Simplify `src/utils/path-translator.ts` to basic two-mode logic
2. Update `src/server.ts` to remove PathTranslator dependency
3. Update `src/session/session-manager.ts` with simple path resolution
4. Run unit tests and fix immediate failures

### Phase 2: Test Updates
1. Rewrite `tests/unit/utils/path-translator.test.ts`
2. Delete `tests/unit/utils/path-translator-container-bug.test.ts`
3. Simplify integration tests
4. Update E2E tests
5. Verify all tests pass

### Phase 3: Documentation Cleanup
1. Update/rewrite core documentation files
2. Delete obsolete documentation
3. Update README if needed
4. Remove environment variable documentation

### Phase 4: Configuration Cleanup
1. Update `check-env.cmd`
2. Verify Docker configuration
3. Update any deployment scripts

### Phase 5: Final Cleanup and Verification
1. Delete all temporary/debug files
2. Clean up generated files
3. Full test suite run
4. Documentation review
5. Verify no remaining references to removed features

## Success Criteria

- [ ] PathTranslator class simplified to <100 lines
- [ ] No references to `MCP_WORKSPACE_ROOT` in codebase
- [ ] No references to `MCP_HOST_WORKSPACE` in codebase
- [ ] All tests pass with simplified logic
- [ ] Documentation accurately reflects simplified behavior
- [ ] No temporary/debug files remain
- [ ] Simple path resolution: CWD for host, /workspace for container

## Risk Assessment

**Low Risk**: This is a simplification that removes complexity
- Existing functionality will become simpler, not break
- Container mode still works, just with fixed `/workspace` root
- Host mode still works, just with CWD root

**Medium Risk Areas**:
- Test updates - extensive test suite needs modification
- Documentation - substantial documentation needs rewriting

**Mitigation**:
- Phase-by-phase implementation with testing at each step
- Backup of current documentation before modifications
