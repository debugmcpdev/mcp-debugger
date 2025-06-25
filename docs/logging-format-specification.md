# MCP Debugger Logging Format Specification

## Overview

This document defines the structured logging format used by mcp-debugger for visualization purposes. All logs are written to `logs/debug-mcp-server.log` in JSON format for easy parsing by the Terminal UI visualizer.

## Log Entry Types

### 1. Tool Call Logs

#### tool:call
Logged when an MCP tool is invoked.

```json
{
  "timestamp": "2025-01-06T16:15:00.123Z",
  "level": "info",
  "namespace": "debug-mcp:tools",
  "message": "tool:call",
  "tool": "set_breakpoint",
  "sessionId": "abc-123-def-456",
  "sessionName": "My Debug Session",
  "request": {
    "file": "path/to/file.py",
    "line": 42,
    "condition": "x > 10"
  },
  "timestamp": 1736180100123
}
```

#### tool:response
Logged when a tool completes successfully.

```json
{
  "timestamp": "2025-01-06T16:15:00.456Z",
  "level": "info",
  "namespace": "debug-mcp:tools",
  "message": "tool:response",
  "tool": "set_breakpoint",
  "sessionId": "abc-123-def-456",
  "sessionName": "My Debug Session",
  "success": true,
  "response": {
    "breakpointId": "bp-1",
    "verified": true,
    "file": "path/to/file.py",
    "line": 42
  },
  "timestamp": 1736180100456
}
```

#### tool:error
Logged when a tool encounters an error.

```json
{
  "timestamp": "2025-01-06T16:15:00.789Z",
  "level": "error",
  "namespace": "debug-mcp:tools",
  "message": "tool:error",
  "tool": "start_debugging",
  "sessionId": "abc-123-def-456",
  "sessionName": "My Debug Session",
  "error": "Failed to connect to debugger",
  "timestamp": 1736180100789
}
```

### 2. Debug State Logs

#### debug:state
Logged when the debugger state changes (paused, running, stopped).

```json
{
  "timestamp": "2025-01-06T16:15:01.123Z",
  "level": "info",
  "namespace": "debug-mcp:state",
  "message": "debug:state",
  "event": "paused",
  "sessionId": "abc-123-def-456",
  "sessionName": "My Debug Session",
  "reason": "breakpoint",
  "location": {
    "file": "/workspace/src/main.py",
    "line": 42,
    "function": "process_data"
  },
  "threadId": 1,
  "timestamp": 1736180101123
}
```

State events include:
- `paused` - Execution stopped (reasons: breakpoint, step, entry, exception)
- `running` - Execution continuing
- `stopped` - Debug session terminated

### 3. Breakpoint Logs

#### debug:breakpoint
Logged for breakpoint lifecycle events.

```json
{
  "timestamp": "2025-01-06T16:15:02.123Z",
  "level": "info",
  "namespace": "debug-mcp:breakpoint",
  "message": "debug:breakpoint",
  "event": "verified",
  "sessionId": "abc-123-def-456",
  "sessionName": "My Debug Session",
  "breakpointId": "bp-1",
  "file": "/workspace/src/main.py",
  "line": 42,
  "verified": true,
  "timestamp": 1736180102123
}
```

Breakpoint events include:
- `set` - Breakpoint requested
- `verified` - Breakpoint confirmed by debugger
- `hit` - Breakpoint triggered execution pause

### 4. Variable Inspection Logs

#### debug:variables
Logged when variables are retrieved.

```json
{
  "timestamp": "2025-01-06T16:15:03.123Z",
  "level": "info",
  "namespace": "debug-mcp:variables",
  "message": "debug:variables",
  "sessionId": "abc-123-def-456",
  "sessionName": "My Debug Session",
  "frameId": 0,
  "scope": "Locals",
  "variablesReference": 1001,
  "variableCount": 3,
  "variables": [
    {
      "name": "x",
      "type": "int",
      "value": "42"
    },
    {
      "name": "data",
      "type": "dict",
      "value": "{'key': 'value', 'count': 10}... (truncated)"
    },
    {
      "name": "result",
      "type": "list",
      "value": "[1, 2, 3, 4, 5]"
    }
  ],
  "timestamp": 1736180103123
}
```

### 5. Session Lifecycle Logs

#### session:created
Logged when a new debug session is created.

```json
{
  "timestamp": "2025-01-06T16:14:50.123Z",
  "level": "info",
  "namespace": "debug-mcp:session",
  "message": "session:created",
  "sessionId": "abc-123-def-456",
  "sessionName": "My Debug Session",
  "language": "python",
  "pythonPath": "/usr/bin/python3",
  "timestamp": 1736180090123
}
```

#### session:closed
Logged when a debug session is terminated.

```json
{
  "timestamp": "2025-01-06T16:20:00.123Z",
  "level": "info",
  "namespace": "debug-mcp:session",
  "message": "session:closed",
  "sessionId": "abc-123-def-456",
  "sessionName": "My Debug Session",
  "duration": 310000,
  "timestamp": 1736180400123
}
```

### 6. Debug Output Logs

#### debug:output
Logged to capture stdout/stderr from the debugged program.

```json
{
  "timestamp": "2025-01-06T16:15:04.123Z",
  "level": "info",
  "namespace": "debug-mcp:output",
  "message": "debug:output",
  "sessionId": "abc-123-def-456",
  "sessionName": "My Debug Session",
  "category": "stdout",
  "output": "Processing item 42...\n",
  "timestamp": 1736180104123
}
```

## Field Definitions

### Common Fields
- `timestamp`: ISO 8601 string timestamp for display
- `level`: Log level (info, debug, error, warn)
- `namespace`: Logger namespace for categorization
- `message`: Log type identifier for parsing
- `sessionId`: Unique session identifier (UUID)
- `sessionName`: Human-readable session name
- `timestamp`: Unix timestamp in milliseconds (for sorting)

### Tool-specific Fields
- `tool`: Name of the MCP tool
- `request`: Tool input parameters (sanitized)
- `response`: Tool output data
- `error`: Error message string

### Debug-specific Fields
- `event`: Type of debug event
- `reason`: Reason for state change
- `location`: Current execution location
- `threadId`: Debug thread identifier
- `breakpointId`: Unique breakpoint identifier
- `frameId`: Stack frame identifier
- `variablesReference`: DAP variable reference number
- `variables`: Array of variable details

## Data Truncation Rules

To prevent excessively large log entries:

1. **String values**: Truncate at 200 characters
   ```typescript
   if (value.length > 200) {
     value = value.substring(0, 200) + '... (truncated)';
   }
   ```

2. **Array/Object values**: Show first few items/keys
   ```typescript
   // For arrays: show first 5 items
   if (Array.isArray(value) && value.length > 5) {
     value = `[${value.slice(0, 5).join(', ')}... +${value.length - 5} more]`;
   }
   ```

3. **Request/Response objects**: Exclude sensitive fields
   - Remove `pythonPath` absolute paths
   - Exclude environment variables
   - Sanitize file paths to relative when possible

## Parsing Guidelines for TUI

1. **Filtering**: Use the `message` field to filter log types
   ```javascript
   const toolCalls = logs.filter(log => log.message === 'tool:call');
   const stateChanges = logs.filter(log => log.message === 'debug:state');
   ```

2. **Chronological Ordering**: Use `timestamp` (milliseconds) for precise ordering
   ```javascript
   logs.sort((a, b) => a.timestamp - b.timestamp);
   ```

3. **Session Grouping**: Group logs by `sessionId` for multi-session support
   ```javascript
   const sessionLogs = logs.reduce((acc, log) => {
     if (!acc[log.sessionId]) acc[log.sessionId] = [];
     acc[log.sessionId].push(log);
     return acc;
   }, {});
   ```

4. **Event Correlation**: Match tool calls with responses
   ```javascript
   const pendingCalls = new Map();
   logs.forEach(log => {
     if (log.message === 'tool:call') {
       pendingCalls.set(`${log.sessionId}-${log.tool}`, log);
     } else if (log.message === 'tool:response') {
       const call = pendingCalls.get(`${log.sessionId}-${log.tool}`);
       // Correlate call and response
     }
   });
   ```

## Performance Considerations

1. **Log Levels**: 
   - Use `info` for user-facing events (tool calls, state changes)
   - Use `debug` for detailed internal data
   - Configure logger to appropriate level for production vs development

2. **Batching**: Consider buffering logs for high-frequency events

3. **File Rotation**: Implement log rotation to prevent unbounded growth

## Security Considerations

1. **No Secrets**: Never log passwords, API keys, or tokens
2. **Path Sanitization**: Use relative paths when possible
3. **PII Protection**: Avoid logging personally identifiable information
4. **Input Validation**: Sanitize user inputs before logging

## Example Usage in Code

```typescript
// Tool call logging
logger.info('tool:call', {
  tool: toolName,
  sessionId: args.sessionId,
  sessionName: session?.name,
  request: sanitizeRequest(args),
  timestamp: Date.now()
});

// State change logging
logger.info('debug:state', {
  event: 'paused',
  sessionId: sessionId,
  sessionName: session.name,
  reason: stopReason,
  location: {
    file: source.path,
    line: frame.line,
    function: frame.name
  },
  threadId: threadId,
  timestamp: Date.now()
});
```

## Version History

- **v1.0.0** (2025-01-06): Initial specification for TUI visualization support
