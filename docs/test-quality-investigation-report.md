# Test Quality Investigation Report

## Overview
This document tracks instances where tests pass despite real issues in production code, highlighting testing anti-patterns and their fixes.

## Issue 1: Mocked Python Discovery in E2E Tests

### Discovery Date
January 2025

### Problem
E2E tests were mocking `findPythonExecutable` which prevented them from catching a real Python discovery issue on Windows.

### Root Cause
```typescript
// tests/e2e/container-path-translation.test.ts
vi.mock('../../src/utils/python-utils.js', () => ({
  findPythonExecutable: vi.fn()
}));
// ...
vi.mocked(findPythonExecutable).mockResolvedValue(process.platform === 'win32' ? 'python' : 'python3');
```

### Why This Is Bad
1. **E2E tests should test the full stack** - Mocking core functionality defeats the purpose
2. **Real issues go undetected** - The mock hid a production bug where `python3` (often Microsoft Store redirect on Windows) was tried before `python`
3. **False confidence** - Tests pass but users experience failures

### The Real Issue It Hid
On Windows, the Python discovery order was:
```typescript
['py', 'python3', 'python', ...] // python3 before python
```

But `python3` on Windows often redirects to Microsoft Store, causing failures even when `python` is available.

### Fix Applied
1. **Removed the mock** from E2E tests
2. **Fixed the discovery order**:
```typescript
const WINDOWS_PYTHON_COMMANDS = ['py', 'python', 'python3', ...]; // python before python3
const UNIX_PYTHON_COMMANDS = ['python3', 'python', ...]; // python3 first on Unix
```
3. **Enhanced error messages** to show which commands were tried
4. **Added integration test** without mocks to verify real Python discovery

### Lessons Learned
- E2E tests should avoid mocking unless absolutely necessary
- When tests mock core functionality, they test the mock, not the code
- Integration tests without mocks can catch issues that mocked tests miss

## Issue 2: Container Path Translation Tests (Previously Documented)

### Discovery Date
December 2024

### Problem
Tests were directly calling internal path translation methods instead of going through the actual MCP server API.

### Root Cause
Tests were structured to test `PathTranslator` class methods directly rather than testing the full request flow.

### Fix Applied
- Created proper E2E tests that start a real MCP server
- Tests now make actual API calls through the MCP protocol
- Verified that path translation works in real scenarios

## Issue 3: Another E2E Test Mocking Python Discovery

### Discovery Date
January 2025

### Problem
The E2E test in `tests/e2e/debugpy-connection.test.ts` was also mocking `findPythonExecutable`.

### Root Cause
```typescript
// Mock the python-utils module
vi.mock('../../src/utils/python-utils.js', () => ({
  findPythonExecutable: vi.fn()
}));
```

### Why This Is Bad
- Same anti-pattern as Issue 1 - E2E tests mocking core functionality
- Could hide platform-specific Python discovery issues
- Tests the mock behavior instead of real behavior

### Fix Applied
- Removed the mock entirely
- E2E test now uses real Python discovery
- This ensures the test catches real-world Python discovery issues

## Issue 4: Skipped Tests as Technical Debt

### Discovery Date
January 2025

### Problem
A test in `tests/integration/python-discovery.test.ts` was skipped with `it.skip()`.

### Why This Is Bad
- Skipped tests are technical debt
- They give false confidence (appear in test count but don't run)
- They often stay skipped forever
- Dead code in the test suite

### Fix Applied
- Deleted the skipped test entirely
- Added a comment explaining why this scenario is tested in unit tests
- Removed technical debt from the codebase

### Best Practice
Either fix skipped tests or delete them. Don't leave them in the codebase.

## Testing Best Practices

Based on these findings:

1. **E2E tests should test end-to-end**
   - Start real servers
   - Make real API calls
   - Avoid mocks unless testing external dependencies

2. **Unit tests can mock, integration tests should not**
   - Unit tests: Mock dependencies to test in isolation
   - Integration tests: Test real interactions between components
   - E2E tests: Test the complete system as users would use it

3. **Test what users experience**
   - If users run commands, test command execution
   - If users make API calls, test API calls
   - Don't test internal implementation details in E2E tests

4. **When a bug is found in production**
   - First write a failing test that reproduces it
   - Then fix the bug
   - The test proves the fix works and prevents regression

5. **Be suspicious of tests that always pass**
   - If tests never fail, they might be testing mocks
   - Periodically review what tests actually test
   - Consider introducing deliberate bugs to verify tests catch them

6. **No skipped tests**
   - Skipped tests are technical debt
   - Either fix them or delete them
   - Don't let `it.skip()` tests accumulate

## Issue 5: PowerShell `where` Alias Bug

### Discovery Date
January 2025

### Problem
Python discovery failed completely on Windows when run from PowerShell, despite Python being installed and available.

### Root Cause
```typescript
// Original code
const checkCommand = isWindows ? 'where' : 'which';
```

In PowerShell, `where` is aliased to `Where-Object` (a PowerShell cmdlet), not the Windows `where.exe` command. This caused the command to wait for pipeline input instead of checking if a command exists.

### Why Tests Didn't Catch This
- Unit tests mocked the `spawn` behavior completely
- Tests never actually executed `where` in a real PowerShell environment
- The mock always returned the expected result

### The Fix
```typescript
// Fixed code
const checkCommand = isWindows ? 'where.exe' : 'which';
```

### Test Added
```typescript
it('should use where.exe (not where) on Windows to avoid PowerShell alias conflict', async () => {
  // This test ensures we use where.exe explicitly
  expect(mockSpawn).toHaveBeenCalledWith('where.exe', ['python'], expect.any(Object));
  expect(mockSpawn).not.toHaveBeenCalledWith('where', expect.any(Array), expect.any(Object));
});
```

### Lessons Learned
- Platform-specific edge cases need platform-specific tests
- PowerShell vs CMD differences matter for Windows development
- Even simple commands can have environment-specific gotchas
- Tests should verify exact command usage, not just outcomes

## Anti-Pattern Summary

The common thread across all these issues is **"testing the mock instead of the code"**:
- Mocking core functionality in E2E/integration tests
- Tests pass because mocks work, not because code works
- Real bugs hide behind passing tests
- Platform-specific issues go undetected
- Environment-specific edge cases go untested

The solution is simple: mock sparingly, especially in E2E and integration tests, and be aware of platform/environment differences.
