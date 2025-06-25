import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DebugSessionInfo, StackFrame, Variable } from '../../src/session/models'; 
import { DebugProtocol } from '@vscode/debugprotocol'; 
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'node:fs'; // Import the native fs module
import { fileURLToPath } from 'url'; 
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'; // Removed StdioClientTransportParameters
import { ServerResult } from '@modelcontextprotocol/sdk/types.js'; 

// --- SDK-based MCP Client for Testing ---
// let serverProcess: ChildProcess | null = null; // SDK Transport will manage the process
let client: Client | null = null;


async function startTestServer(): Promise<void> {
  const currentFileURL = import.meta.url;
    const currentFilePath = fileURLToPath(currentFileURL);
    const currentDirName = path.dirname(currentFilePath);
    // Path to the server's main executable JS file
    const serverScriptPath = path.resolve(currentDirName, '../../dist/index.js');
    console.log(`[Test Setup] Server script path for SDK StdioClientTransport: ${serverScriptPath}`); 

    client = new Client({
        name: "jest-mcp-test-client",
        version: "0.1.0",
        capabilities: { tools: {} } 
    });

    const filteredEnv: Record<string, string> = {};
    for (const key in process.env) {
        if (process.env[key] !== undefined) {
            filteredEnv[key] = process.env[key] as string;
        }
    }
    const logFilePath = path.resolve(currentDirName, '../../integration_test_server.log'); // Log to project root
    console.log(`[Test Setup] Server log file will be at: ${logFilePath}`);
    // Ensure log file is clean before test run
    try {
      if (fs.existsSync(logFilePath)) {
        fs.unlinkSync(logFilePath);
      }
    } catch (e) { console.error(`Error deleting old log file: ${e}`); }

    const transport = new StdioClientTransport({
        command: 'node',
        args: [serverScriptPath, '--log-level', 'debug', '--log-file', logFilePath],
        env: filteredEnv, // Pass filtered environment to the server process
        // CWD might be needed if serverScriptPath is not absolute or if the server relies on a specific CWD
        // cwd: path.resolve(currentDirName, '../../') // Example: project root
    });

    // StdioClientTransport will log its own stderr/stdout from the child process if configured.
    // We don't need to manually attach to serverProcess.stderr anymore if transport handles it.
    // The transport also manages the lifecycle of the spawned process.

    try {
        console.log('[Test Server] Attempting to connect SDK client (which will spawn server)...');
        await client.connect(transport); // This spawns the server and handles initialize
        console.log('[Test Server] SDK Client connected, server spawned, and initialized successfully.');
    } catch (error) {
        console.error('[Test Server] SDK Client connection/spawn/initialization failed:', error);
        client = null; // Ensure client is null if connect failed
        throw error; 
    }
}

async function stopTestServer(): Promise<void> {
  if (client) {
    console.log('[Test Server] Closing SDK client connection (should terminate server)...');
    try {
      await client.close(); 
      console.log('[Test Server] SDK Client closed successfully.');
    } catch (e) {
      console.error('[Test Server] Error closing SDK client:', e);
    }
  }
  client = null;
  // serverProcess is no longer managed directly here; StdioClientTransport handles it.
}

// processBufferedResponses and old callMcpTool are no longer needed.
// The SDK Client's callTool method will be used directly.

// Helper to introduce delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('Python Debugging Workflow - Integration Test', () => {
  let sessionId: string;
  const scriptPath = path.resolve('tests/fixtures/python/debug_test_simple.py'); // Absolute path
  const breakpointLine = 14; // Line 'c = a + b' in debug_test_simple.py

  beforeAll(async () => {
    await startTestServer();
  });

  afterAll(async () => {
    await stopTestServer();
  });

  it('should complete a full debug session and inspect local variables', async () => {
    if (!client) { // Check if client was initialized
      throw new Error("MCP Client not initialized. Cannot run test.");
    }

    if (!client) { 
      throw new Error("MCP Client not initialized. Cannot run test.");
    }

    // Helper to parse ServerResult
    const parseToolResult = (rawResult: any) => { // Accept any directly
      const anyResult = rawResult as any; 
      if (!anyResult || !anyResult.content || !anyResult.content[0] || anyResult.content[0].type !== 'text') {
        console.error("Invalid ServerResult structure received:", rawResult);
        throw new Error('Invalid ServerResult structure');
      }
      return JSON.parse(anyResult.content[0].text);
    };

    // 1. List Sessions (simpler first call)
    // Do not type listRawResult as ServerResult if its type is problematic
    let listRawResult = await client.callTool({ name: 'list_debug_sessions', arguments: {} });
    const listResult = parseToolResult(listRawResult);
    expect(listResult.success).toBe(true);
    expect(listResult.sessions).toBeInstanceOf(Array);
    console.log(`[Test] Listed sessions (count: ${listResult.sessions.length})`);

    // 2. Create Session
    let createRawResult = await client.callTool({ name: 'create_debug_session', arguments: { language: 'python', name: 'integrationTestSession' } });
    const createResult = parseToolResult(createRawResult);
    expect(createResult.success).toBe(true);
    expect(createResult.sessionId).toBeDefined();
    sessionId = createResult.sessionId;
    console.log(`[Test] Created session: ${sessionId}`);

    // 3. Set Breakpoint
    let breakpointRawResult = await client.callTool({ name: 'set_breakpoint', arguments: { sessionId, file: scriptPath, line: breakpointLine } });
    const breakpointResult = parseToolResult(breakpointRawResult);
    expect(breakpointResult.success).toBe(true);
    // Compare absolute paths
    expect(breakpointResult.file).toBe(scriptPath);
    expect(breakpointResult.line).toBe(breakpointLine);
    console.log(`[Test] Set breakpoint at ${scriptPath}:${breakpointLine}`);

    // 4. Start Debugging
    let startRawResult = await client.callTool({ name: 'start_debugging', arguments: { sessionId, scriptPath } });
    const startResult = parseToolResult(startRawResult);
    console.log('[Test] Start debugging result:', JSON.stringify(startResult, null, 2));
    expect(startResult.success).toBe(true);
    expect(startResult.state).toBe('paused'); 
    console.log('[Test] Started debugging, initially paused (stopOnEntry).');

    // 5. Continue to Breakpoint
    let continueRawResult = await client.callTool({ name: 'continue_execution', arguments: { sessionId } });
    const continueResult = parseToolResult(continueRawResult);
    expect(continueResult.success).toBe(true);
    console.log('[Test] Continued execution. Waiting for breakpoint...');
    await delay(3000); 

    // 6. Get Stack Trace (at breakpoint)
    let stackTraceRawResult = await client.callTool({ name: 'get_stack_trace', arguments: { sessionId } });
    const stackTraceResult = parseToolResult(stackTraceRawResult);
    expect(stackTraceResult.success).toBe(true);
    expect(stackTraceResult.stackFrames).toBeInstanceOf(Array);
    expect(stackTraceResult.stackFrames.length).toBeGreaterThanOrEqual(1);
    
    const topFrame = stackTraceResult.stackFrames[0] as StackFrame;
    // Use toContain for file path as debugpy returns absolute paths
    expect(topFrame.file).toContain('debug_test_simple.py');
    expect(topFrame.name).toBe('sample_function'); 
    expect(topFrame.line).toBe(breakpointLine);
    const frameId = topFrame.id;
    console.log(`[Test] Paused at stack frame: ${topFrame.name} (ID: ${frameId}) line ${topFrame.line}`);

    // 7. Get Scopes
    let scopesRawResult = await client.callTool({ name: 'get_scopes', arguments: { sessionId, frameId } });
    const scopesResult = parseToolResult(scopesRawResult);
    expect(scopesResult.success).toBe(true);
    expect(scopesResult.scopes).toBeInstanceOf(Array);
    const localsScope = scopesResult.scopes.find((s: DebugProtocol.Scope) => s.name === 'Locals');
    expect(localsScope).toBeDefined();
    if (!localsScope) throw new Error("Locals scope not found in get_scopes response");
    const localsVariablesRef = localsScope.variablesReference;
    console.log(`[Test] Got scopes. Locals ref: ${localsVariablesRef}`);

    // 8. Get Variables (Locals of sample_function)
    let variablesRawResult = await client.callTool({ name: 'get_variables', arguments: { sessionId, scope: localsVariablesRef } });
    const variablesResult = parseToolResult(variablesRawResult);
    expect(variablesResult.success).toBe(true);
    expect(variablesResult.variables).toBeInstanceOf(Array);

    const varA = variablesResult.variables.find((v: Variable) => v.name === 'a');
    expect(varA).toBeDefined();
    if (!varA) throw new Error("Variable 'a' not found"); 
    expect(varA.value).toBe('5');
    expect(varA.type).toBe('int');

    const varB = variablesResult.variables.find((v: Variable) => v.name === 'b');
    expect(varB).toBeDefined();
    if (!varB) throw new Error("Variable 'b' not found"); 
    expect(varB.value).toBe('10');
    expect(varB.type).toBe('int');
    console.log('[Test] Verified local variables a and b.');

    // 9. Close Session
    let closeRawResult = await client.callTool({ name: 'close_debug_session', arguments: { sessionId } });
    const closeResult = parseToolResult(closeRawResult);
    expect(closeResult.success).toBe(true);
    console.log(`[Test] Closed session: ${sessionId}`);
  });

  it('should perform a dry run for start_debugging and log the command', async () => {
    if (!client) {
      throw new Error("MCP Client not initialized. Cannot run test.");
    }
    const parseToolResult = (rawResult: any) => {
      const anyResult = rawResult as any;
      if (!anyResult || !anyResult.content || !anyResult.content[0] || anyResult.content[0].type !== 'text') {
        console.error("Invalid ServerResult structure received:", rawResult);
        throw new Error('Invalid ServerResult structure');
      }
      return JSON.parse(anyResult.content[0].text);
    };

    console.log('[Test] === Test: Dry Run for start_debugging ===');
    const scriptToDryRun = path.resolve('tests/fixtures/python/debug_test_simple.py'); // Absolute path

    // Create a new session for the dry run test
    let createDryRunRawResult = await client.callTool({ name: 'create_debug_session', arguments: { language: 'python', name: 'DryRunTestSession' } });
    const createDryRunResult = parseToolResult(createDryRunRawResult);
    expect(createDryRunResult.success).toBe(true);
    const dryRunSessionId = createDryRunResult.sessionId;
    console.log(`[Test] Created session for dry run: ${dryRunSessionId}`);

    // Call start_debugging with dryRunSpawn: true
    console.log(`[Test] Calling start_debugging with dryRunSpawn: true for session ${dryRunSessionId}`);
    let startDryRunRawResult = await client.callTool({
      name: 'start_debugging',
      arguments: {
        sessionId: dryRunSessionId,
        scriptPath: scriptToDryRun,
        dryRunSpawn: true,
      },
    });
    const parsedDryRunResult = parseToolResult(startDryRunRawResult);
    
    console.log('[Test] Dry run start_debugging result:', JSON.stringify(parsedDryRunResult, null, 2));
    if (!parsedDryRunResult.success) {
      console.error('[Test] Dry run failed with error:', parsedDryRunResult.error);
    }
    expect(parsedDryRunResult.success).toBe(true);
    // SessionManager's startDebugging for a successful dry run returns:
    // { success: true, state: session.state (STOPPED), data: { dryRun: true, message: "Dry run spawn command logged by proxy." } };
    expect(parsedDryRunResult.state).toBe('stopped'); // SessionManager sets state to STOPPED after dry run
    expect(parsedDryRunResult.data?.dryRun).toBe(true);
    expect(parsedDryRunResult.data?.message).toContain("Dry run spawn command logged by proxy.");

    console.log('[Test] Dry run test completed. Manual log inspection needed for dap-proxy command.');
    // Add a small delay if needed for logs to flush, though the proxy should exit quickly.
    await delay(1000); 

    // Clean up the dry run session
    await client.callTool({ name: 'close_debug_session', arguments: { sessionId: dryRunSessionId } });
    console.log(`[Test] Closed dry run session: ${dryRunSessionId}`);
  });
}, 60000); // 60 seconds timeout for the entire suite
