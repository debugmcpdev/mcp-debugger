/**
 * @jest-environment node
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ServerResult } from '@modelcontextprotocol/sdk/types.js';

const TEST_TIMEOUT = 15000; // Shorter timeout for expected failure

let mcpSdkClient: Client | null = null;
const projectRoot = process.cwd();

// Helper function to parse SDK tool results
interface ParsedToolResult {
  sessionId?: string;
  success?: boolean;
  [key: string]: unknown;
}

const parseSdkToolResult = (rawResult: ServerResult): ParsedToolResult => {
  const contentArray = (rawResult as { content?: Array<{ type: string; text: string }> }).content;
  if (!contentArray || !Array.isArray(contentArray) || contentArray.length === 0 || contentArray[0].type !== 'text') {
    console.error("Invalid ServerResult structure received from SDK:", rawResult);
    throw new Error('Invalid ServerResult structure from SDK or missing text content');
  }
  return JSON.parse(contentArray[0].text);
};

describe('MCP Server E2E Smoke Test', () => {
  // Ensure server is killed even if test fails
  afterEach(async () => {
    if (mcpSdkClient) {
      await mcpSdkClient.close();
      mcpSdkClient = null;
    }
  });

  it('should successfully debug fibonacci.py in production build', async () => {
    let stderrOutput = '';
    
    // 1. Build server (already done in package.json test:e2e or manually)
    // 2. Create MCP client and connect using stdio transport
    console.log('[E2E Smoke Test] Connecting MCP SDK client via stdio...');
    mcpSdkClient = new Client({ name: "e2e-smoke-test-client", version: "0.1.0" });
    
    // StdioClientTransport will spawn the server process for us
    const transport = new StdioClientTransport({
      command: 'node',
      args: [path.join(projectRoot, 'dist', 'index.js'), 'stdio'],
    });
    
    // Capture stderr for debugging
    transport.onerror = (error) => {
      console.error('[E2E Smoke Test] Transport error:', error);
      stderrOutput += error.toString();
    };
    
    await mcpSdkClient.connect(transport);
    console.log('[E2E Smoke Test] MCP SDK Client connected via stdio.');

    // 4. Execute tool sequence
    let debugSessionId: string | undefined;
    try {
      // 4.1. Create debug session (Python)
      console.log('[E2E Smoke Test] Creating debug session...');
      const createCall = await mcpSdkClient.callTool({
        name: 'create_debug_session',
        arguments: { language: 'python', name: 'E2E Smoke Test Session' }
      });
      const createToolResponse = parseSdkToolResult(createCall);
      expect(createToolResponse.sessionId).toBeDefined();
      debugSessionId = createToolResponse.sessionId;
      console.log(`[E2E Smoke Test] Debug session created: ${debugSessionId}`);

      // 4.2. Set breakpoint (fibonacci.py line 32)
      console.log('[E2E Smoke Test] Setting breakpoint...');
      const fibonacciPath = path.join(projectRoot, 'examples', 'python', 'fibonacci.py');
      const breakpointCall = await mcpSdkClient.callTool({
        name: 'set_breakpoint',
        arguments: { sessionId: debugSessionId, file: fibonacciPath, line: 32 }
      });
      const breakpointResponse = parseSdkToolResult(breakpointCall);
      expect(breakpointResponse.success).toBe(true);
      console.log('[E2E Smoke Test] Breakpoint set.');

      // 4.3. Start debugging
      console.log('[E2E Smoke Test] Starting debugging...');
      const debugCall = await mcpSdkClient.callTool({
        name: 'start_debugging',
        arguments: {
          sessionId: debugSessionId,
          scriptPath: fibonacciPath,
          dapLaunchArgs: { stopOnEntry: true }
        }
      });
      const debugResponse = parseSdkToolResult(debugCall);
      expect(debugResponse.success).toBe(true);
      expect(debugResponse.state).toBe('paused'); // Should be paused due to stopOnEntry
      console.log('[E2E Smoke Test] Debugging started successfully.');

    } catch (error) {
      console.error('[E2E Smoke Test] Unexpected error during test execution:', error);
      console.error('[E2E Smoke Test] Server stderr output:', stderrOutput);
      throw error; // Re-throw to ensure the test fails if the error is not the expected one
    } finally {
      // 5. Cleanup
      if (debugSessionId) {
        try {
          await mcpSdkClient?.callTool({ name: 'close_debug_session', arguments: { sessionId: debugSessionId } });
          console.log(`[E2E Smoke Test] Debug session ${debugSessionId} closed.`);
        } catch (e) {
          console.error(`[E2E Smoke Test] Error closing debug session ${debugSessionId}:`, e);
        }
      }
    }
  }, TEST_TIMEOUT);

  // Test spawning the server from a different working directory
  it('should work when server is spawned from different working directory', async () => {
    const tempDir = os.tmpdir();
    console.log(`[E2E Smoke Test] Will spawn server with cwd: ${tempDir}`);
    
    let stderrOutput = '';
    let debugSessionId: string | undefined;
    
    try {
      // Create MCP client and connect using stdio transport
      console.log('[E2E Smoke Test] Connecting MCP SDK client via stdio with temp cwd...');
      mcpSdkClient = new Client({ name: "e2e-smoke-test-client", version: "0.1.0" });
      
      // StdioClientTransport will spawn the server process with temp directory as cwd
      const transport = new StdioClientTransport({
        command: 'node',
        args: [path.join(projectRoot, 'dist', 'index.js'), 'stdio'],
        env: {
          ...process.env,
          // Add project root to env so server can find resources if needed
          MCP_DEBUG_PROJECT_ROOT: projectRoot
        },
        cwd: tempDir // Spawn the server from temp directory
      });
      
      // Capture stderr for debugging
      transport.onerror = (error) => {
        console.error('[E2E Smoke Test] Transport error:', error);
        stderrOutput += error.toString();
      };
      
      await mcpSdkClient.connect(transport);
      console.log('[E2E Smoke Test] MCP SDK Client connected via stdio from temp directory.');

      // Create debug session
      console.log('[E2E Smoke Test] Creating debug session...');
      const createCall = await mcpSdkClient.callTool({
        name: 'create_debug_session',
        arguments: { language: 'python', name: 'E2E Smoke Test Session (Temp Dir)' }
      });
      const createToolResponse = parseSdkToolResult(createCall);
      expect(createToolResponse.sessionId).toBeDefined();
      debugSessionId = createToolResponse.sessionId;
      console.log(`[E2E Smoke Test] Debug session created: ${debugSessionId}`);

      // Set breakpoint
      console.log('[E2E Smoke Test] Setting breakpoint...');
      const fibonacciPath = path.join(projectRoot, 'examples', 'python', 'fibonacci.py');
      const breakpointCall = await mcpSdkClient.callTool({
        name: 'set_breakpoint',
        arguments: { sessionId: debugSessionId, file: fibonacciPath, line: 32 }
      });
      const breakpointResponse = parseSdkToolResult(breakpointCall);
      expect(breakpointResponse.success).toBe(true);
      console.log('[E2E Smoke Test] Breakpoint set.');

      // Start debugging - this might fail if there are path resolution issues
      console.log('[E2E Smoke Test] Starting debugging from temp directory...');
      const debugCall = await mcpSdkClient.callTool({
        name: 'start_debugging',
        arguments: {
          sessionId: debugSessionId,
          scriptPath: fibonacciPath,
          dapLaunchArgs: { stopOnEntry: true }
        }
      });
      const debugResponse = parseSdkToolResult(debugCall);
      
      // Log the full response to understand the error
      console.log('[E2E Smoke Test] Debug response:', JSON.stringify(debugResponse, null, 2));
      
      // This is where we expect to see the "Bootstrap worker script not found" error
      if (!debugResponse.success) {
        console.error('[E2E Smoke Test] FOUND THE ISSUE! Debugging failed when server spawned from different directory.');
        console.error('[E2E Smoke Test] Error details:', debugResponse);
      }
      
      expect(debugResponse.success).toBe(true);
      expect(debugResponse.state).toBe('paused');
      console.log('[E2E Smoke Test] Debugging started successfully from temp directory.');

    } catch (error) {
      console.error('[E2E Smoke Test] Error during test execution from temp directory:', error);
      console.error('[E2E Smoke Test] Server stderr output:', stderrOutput);
      throw error;
    } finally {
      // Cleanup
      if (debugSessionId && mcpSdkClient) {
        try {
          await mcpSdkClient.callTool({ name: 'close_debug_session', arguments: { sessionId: debugSessionId } });
          console.log(`[E2E Smoke Test] Debug session ${debugSessionId} closed.`);
        } catch (e) {
          console.error(`[E2E Smoke Test] Error closing debug session ${debugSessionId}:`, e);
        }
      }
    }
  }, TEST_TIMEOUT);
});
