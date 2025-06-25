# Vitest Output Optimization for LLM Development

## Overview

When working with LLMs on development tasks, test output can consume significant tokens due to verbose progress indicators and passing test details. This document describes the optimization implemented in `scripts/llm-env.ps1` that reduces test output by ~90% while preserving all critical debugging information.

## Problem

Standard `npm test` output includes:
- Dynamic progress updates that create duplicate lines when captured
- Details for every passing test
- Verbose formatting with Unicode symbols
- Intermediate summary lines

Example of problematic output captured by LLM:
```
❯ tests/e2e/debugpy-connection.test.ts 0/2
Test Files 1 failed | 0 passed (48)
Tests 2 failed | 0 passed (4)
Duration 1.89s

❯ tests/e2e/debugpy-connection.test.ts 0/2
Test Files 1 failed | 0 passed (48)
Tests 2 failed | 0 passed (4)
Duration 2.96s
```

## Solution

The script uses TAP (Test Anything Protocol) reporter with intelligent filtering:

### Why TAP?
- **35+ year stable format** - Rarely changes between versions
- **Simple patterns** - Easy to parse reliably
- **No progress updates** - Designed for CI/non-interactive use
- **Structured output** - Clear separation of test results

### Implementation

```powershell
# Force CI mode to prevent dynamic updates
$env:CI = 'true'

# Use TAP reporter with coverage
npm test -- --reporter=tap --coverage

# Filter to show only:
# - TAP header (version, test count)
# - Failed test files and their details
# - Coverage report
# - Skip all passing test output
```

## Usage

```powershell
# Source the optimization script
. ./scripts/llm-env.ps1

# All npm commands work naturally - no need to remember npm.cmd
npm run build      # Works perfectly (pass-through)
npm install        # Works perfectly (pass-through)
npm test           # Automatically optimized (failures + coverage only)
npm test:unit      # Optimized unit tests
npm test:int       # Optimized integration tests
npm test:e2e       # Optimized e2e tests

# Original commands still available if needed
npm.cmd test       # Bypass optimization
```

## Results

### Before Optimization
- ~15,000+ characters of output
- Hundreds of duplicate progress lines
- Details for all 700+ passing tests

### After Optimization
- ~1,500 characters for same test run
- Only failed tests with full stack traces
- Complete coverage report maintained
- **~90% reduction in token usage**

### Example Optimized Output
```
TAP version 13
1..48
not ok 5 - tests/integration/python_debug_workflow.test.ts # time=731.82ms {
    1..1
    not ok 1 - Python Debugging Workflow - Integration Test # time=731.22ms {
        1..2
        not ok 1 - should complete a full debug session # time=239.87ms
            ---
            error:
                name: "AssertionError"
                message: "expected false to be true"
            at: "tests/integration/python_debug_workflow.test.ts:150:33"
            actual: "false"
            expected: "true"
            ...
    }
}
% Coverage report from istanbul
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   90.39 |    84.81 |   91.83 |   90.55 |
...
```

## Technical Details

### TAP Filtering Logic
1. Always show TAP header and test plan
2. Track nested test structure with depth counter
3. When `ok X - file.ts` seen → skip entire block
4. When `not ok X - file.ts` seen → show entire block
5. Always show coverage report at end

### Key Regex Patterns
- Failed test file: `^not ok \d+ - .*\.ts`
- Passing test file: `^ok \d+ - .*\.ts`
- Coverage lines: Multiple patterns to catch all report lines

## Benefits

1. **Token Efficiency**: 90% reduction in LLM token usage
2. **Debugging Focus**: Only see what needs attention
3. **Coverage Tracking**: Maintains ability to monitor >90% requirement
4. **Stable Format**: TAP's stability reduces maintenance
5. **Zero Config**: Works automatically when script is sourced

## Docker Build Optimization

The script also optimizes Docker build output to prevent duplicate progress lines:

### Problem
Docker's default BuildKit output creates dynamic progress updates that result in hundreds of duplicate lines when captured by LLMs:
```
[+] Building 0.2s (1/3)
[+] Building 0.3s (1/3)
[+] Building 0.4s (1/3)
... (hundreds of duplicates)
```

### Solution
The script automatically adds `--progress=plain` to all `docker build` commands:
```powershell
docker build -t myimage .
# Automatically becomes:
docker build --progress=plain -t myimage .
```

This provides clean, linear output without duplicates while preserving all build information.

## Future Improvements

- Could add filtering for specific test name patterns
- Consider caching coverage data between runs
- Explore other stable formats (JUnit XML, etc.)
- Add more command optimizations (git operations, etc.)
