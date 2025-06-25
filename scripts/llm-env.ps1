# LLM Environment Helper - Optimized Test Output for Token Efficiency
# 
# This script optimizes test output for information density when working with LLMs.
# It suppresses output from passing tests while preserving full details for failures.
#
# Usage: 
#   . ./scripts/llm-env.ps1
#
# This will override 'npm test' commands to show only failures and coverage.
# Original commands are still accessible via their .cmd/.exe versions.
#
# WARNING: Avoid smart quotes in PowerShell scripts! Use regular apostrophes (')
# Some text editors auto-convert quotes - disable this feature when editing scripts.

# Override npm to add quiet behavior for test commands
function npm {
    # Join args only for pattern matching, keep original for pass-through
    $argsString = $args -join ' '
    
    # Intercept test commands and optimize for information density
    if ($argsString -match '^(run )?test(\s|$)') {
        Write-Host "[LLM Mode] Running optimized test output (TAP filtered + coverage)" -ForegroundColor Cyan
        # Set CI mode to prevent dynamic updates
        $env:CI = 'true'
        
        # Since npm test runs test:unit && test:integration, we need to run vitest directly
        # Run all tests with TAP reporter and filter output
        $inFailure = $false
        $skipDepth = 0
        & npm.cmd run test:coverage -- --reporter=tap 2>&1 | ForEach-Object {
            # Always show TAP header, test plan
            if ($_ -match '^TAP version' -or $_ -match '^\d+\.\.\d+$' -or $_ -match '^#') {
                $_
            }
            # Coverage report (all lines after coverage header)
            elseif ($_ -match '^\s*%' -or $_ -match '^-+\|' -or $_ -match '^File\s+\|' -or $_ -match '^All files\s+\|' -or ($_ -match '^\s+\S+.*\|' -and $_ -match '\d+\.\d+')) {
                $_
            }
            # Start of a failed test file
            elseif ($_ -match '^not ok \d+ - .*\.ts') {
                $inFailure = $true
                $_
            }
            # Start of a passing test file - skip it and its contents
            elseif ($_ -match '^ok \d+ - .*\.ts') {
                $skipDepth = 1
            }
            # Track nesting depth for skipping
            elseif ($skipDepth -gt 0) {
                if ($_ -match '^\s*\{') { $skipDepth++ }
                elseif ($_ -match '^\s*\}') { 
                    $skipDepth--
                    if ($skipDepth -eq 0) {
                        # Skip the closing brace of the test file too
                        return
                    }
                }
            }
            # Inside failure - show everything including nested content
            elseif ($inFailure) {
                $_
                # Only exit failure mode when we see the closing brace at file level
                if ($_ -match '^}$') {
                    $inFailure = $false
                }
            }
            # Pass through empty lines and terminal prompt
            elseif ($_ -eq '' -or $_ -match '^;Cwd=' -or $_ -match '^PS ') {
                $_
            }
        }
    }
    elseif ($argsString -match '^(run )?test:unit') {
        Write-Host "[LLM Mode] Running optimized unit tests (TAP filtered + coverage)" -ForegroundColor Cyan
        $env:CI = 'true'
        $inFailure = $false
        & npm.cmd run test:unit -- --reporter=tap --coverage 2>&1 | ForEach-Object {
            if ($_ -match '^TAP version' -or $_ -match '^\d+\.\.\d+$' -or $_ -match '^#' -or $_ -match '^\s*%') { $_ }
            elseif ($_ -match '^not ok') { $inFailure = $true; $_ }
            elseif ($inFailure -and $_ -match '^\s+') { $_ }
            elseif ($inFailure -and $_ -match '^(ok|not ok)') { 
                $inFailure = $false
                if ($_ -match '^not ok') { $_ }
            }
            elseif ($_ -match '^ok') { }
            else { $_ }
        }
    }
    elseif ($argsString -match '^(run )?test:int') {
        Write-Host "[LLM Mode] Running optimized integration tests (TAP filtered + coverage)" -ForegroundColor Cyan
        $env:CI = 'true'
        $inFailure = $false
        & npm.cmd run test:integration -- --reporter=tap --coverage 2>&1 | ForEach-Object {
            if ($_ -match '^TAP version' -or $_ -match '^\d+\.\.\d+$' -or $_ -match '^#' -or $_ -match '^\s*%') { $_ }
            elseif ($_ -match '^not ok') { $inFailure = $true; $_ }
            elseif ($inFailure -and $_ -match '^\s+') { $_ }
            elseif ($inFailure -and $_ -match '^(ok|not ok)') { 
                $inFailure = $false
                if ($_ -match '^not ok') { $_ }
            }
            elseif ($_ -match '^ok') { }
            else { $_ }
        }
    }
    elseif ($argsString -match '^(run )?test:e2e') {
        Write-Host "[LLM Mode] Running optimized e2e tests (TAP filtered + coverage)" -ForegroundColor Cyan
        $env:CI = 'true'
        $inFailure = $false
        & npm.cmd run test:e2e -- --reporter=tap --coverage 2>&1 | ForEach-Object {
            if ($_ -match '^TAP version' -or $_ -match '^\d+\.\.\d+$' -or $_ -match '^#' -or $_ -match '^\s*%') { $_ }
            elseif ($_ -match '^not ok') { $inFailure = $true; $_ }
            elseif ($inFailure -and $_ -match '^\s+') { $_ }
            elseif ($inFailure -and $_ -match '^(ok|not ok)') { 
                $inFailure = $false
                if ($_ -match '^not ok') { $_ }
            }
            elseif ($_ -match '^ok') { }
            else { $_ }
        }
    }
    else {
        # Pass through other npm commands unchanged with proper argument expansion
        & npm.cmd @args
    }
}

# Override docker to add optimized output for build commands
function docker {
    # Join args only for pattern matching, keep original for pass-through
    $argsString = $args -join ' '
    
    # Intercept build commands and add --progress=plain to avoid duplicate lines
    if ($argsString -match '^build\s') {
        Write-Host "[LLM Mode] Running docker build with plain progress" -ForegroundColor Cyan
        # Check if --progress is already specified
        if ($argsString -notmatch '--progress') {
            # Insert --progress=plain after "build"
            $newArgs = @($args[0]) + @('--progress=plain') + $args[1..($args.Length - 1)]
            & docker.exe @newArgs
        }
        else {
            # Progress already specified, use as-is
            & docker.exe @args
        }
    }
    else {
        # Pass through other docker commands unchanged
        & docker.exe @args
    }
}

function git-clone {
    Write-Host "[LLM Mode] Running quiet git clone" -ForegroundColor Cyan
    & git.exe clone --quiet @args
}

# Helper to show current overrides
function Show-LLMHelpers {
    Write-Host "`nLLM Mode Active - Optimized Command Overrides:" -ForegroundColor Green
    Write-Host "  npm test         -> Shows only failures + coverage (silent for passes)" -ForegroundColor Yellow
    Write-Host "  npm test:unit    -> Shows only unit test failures + coverage" -ForegroundColor Yellow
    Write-Host "  npm test:int     -> Shows only integration test failures + coverage" -ForegroundColor Yellow
    Write-Host "  npm test:e2e     -> Shows only e2e test failures + coverage" -ForegroundColor Yellow
    Write-Host "  docker build     -> Uses --progress=plain (no duplicate lines)" -ForegroundColor Yellow
    Write-Host "  git-clone        -> Quiet git clone" -ForegroundColor Yellow
    Write-Host "`nUse original commands: npm.cmd, docker.exe, git.exe" -ForegroundColor Cyan
}

# Show helpers on load
Write-Host "`n✓ LLM environment helpers loaded" -ForegroundColor Green
Write-Host "  Type Show-LLMHelpers to see available quiet commands" -ForegroundColor Gray
