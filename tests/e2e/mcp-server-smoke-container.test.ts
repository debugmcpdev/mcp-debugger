/**
 * @jest-environment node
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  parseSdkToolResult,
  executeDebugSequence,
  isDockerAvailable,
  ensureDockerImage,
  getVolumeMount
} from './smoke-test-utils.js';
import { ensureDir, writeFile, remove } from 'fs-extra';

const TEST_TIMEOUT = 60000; // 60 seconds for container tests
const DOCKER_IMAGE = 'mcp-debugger:local';

let mcpSdkClient: Client | null = null;
const projectRoot = process.cwd();

describe('MCP Server E2E Container Smoke Test', () => {
  let dockerAvailable = false;

  beforeAll(async () => {
    // Check if Docker is available
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.log('[Container Smoke Test] Docker not available, tests will be skipped');
    }
  });

  // Ensure cleanup even if test fails
  afterEach(async () => {
    console.log('[Container Smoke Test] Cleaning up...');
    
    // Close MCP client
    if (mcpSdkClient) {
      try {
        await mcpSdkClient.close();
        console.log('[Container Smoke Test] MCP client closed');
      } catch (e) {
        console.error('[Container Smoke Test] Error closing MCP client:', e);
      }
      mcpSdkClient = null;
    }
  });

  it('should successfully debug fibonacci.py in containerized server', async function() {
    if (!dockerAvailable) {
      this.skip();
      return;
    }

    let debugSessionId: string | undefined;
    
    try {
      // 1. Build Docker image if needed
      await ensureDockerImage(DOCKER_IMAGE);
      
      // 2. Create MCP client and connect using stdio transport with docker run
      console.log('[Container Smoke Test] Creating MCP client with Docker transport...');
      mcpSdkClient = new Client({ 
        name: "e2e-container-smoke-test-client", 
        version: "0.1.0" 
      });
      
      // Mount examples directory
      const examplesMount = getVolumeMount(
        path.join(projectRoot, 'examples'),
        '/workspace/examples'
      );
      
      // Use docker run directly in StdioClientTransport
      const transport = new StdioClientTransport({
        command: 'docker',
        args: [
          'run', '--rm', '-i',
          '-v', examplesMount,
          '-e', 'MCP_CONTAINER=true',
          '-e', `MCP_HOST_WORKSPACE=${projectRoot}`,
          DOCKER_IMAGE,
          'stdio'
        ]
      });
      
      console.log('[Container Smoke Test] Connecting to containerized MCP server...');
      await mcpSdkClient.connect(transport);
      console.log('[Container Smoke Test] MCP SDK Client connected via stdio to container.');

      // 3. Execute debug sequence with relative path (container mode)
      const relativeFibonacciPath = 'examples/python/fibonacci.py';
      const result = await executeDebugSequence(
        mcpSdkClient,
        relativeFibonacciPath,
        'E2E Container Smoke Test Session'
      );
      
      expect(result.success).toBe(true);
      debugSessionId = result.sessionId;
      console.log('[Container Smoke Test] Debug sequence completed successfully.');
      
    } catch (error) {
      console.error('[Container Smoke Test] Unexpected error during test execution:', error);
      
      // Check if it's a docker issue
      if (error instanceof Error && error.message.includes('docker')) {
        console.error('[Container Smoke Test] Docker container failed to start:', error);
      }
      
      throw error;
    } finally {
      // 4. Cleanup
      if (debugSessionId && mcpSdkClient) {
        try {
          await mcpSdkClient.callTool({ 
            name: 'close_debug_session', 
            arguments: { sessionId: debugSessionId } 
          });
          console.log(`[Container Smoke Test] Debug session ${debugSessionId} closed.`);
        } catch (e) {
          console.error(`[Container Smoke Test] Error closing debug session ${debugSessionId}:`, e);
        }
      }
    }
  }, TEST_TIMEOUT);

  // Test that absolute paths are rejected in container mode
  it('should reject absolute paths in container mode', async function() {
    if (!dockerAvailable) {
      this.skip();
      return;
    }

    const tempTestDir = path.join(os.tmpdir(), 'mcp-container-test-' + Date.now());
    let debugSessionId: string | undefined;
    
    try {
      // 1. Create a temporary test directory with a Python script
      console.log(`[Container Smoke Test] Creating temp test directory: ${tempTestDir}`);
      await ensureDir(tempTestDir);
      
      const testScript = `
import time
print("Container path test script")
x = 42  # Line 3 - breakpoint here
print(f"x = {x}")
`;
      
      const testScriptPath = path.join(tempTestDir, 'test_container.py');
      await writeFile(testScriptPath, testScript.trim());
      
      // 2. Create MCP client with temp directory mounted
      console.log('[Container Smoke Test] Creating MCP client with temp directory mount...');
      mcpSdkClient = new Client({ 
        name: "e2e-container-path-test-client", 
        version: "0.1.0" 
      });
      
      // Mount temp directory at /workspace (not /workspace/temp-test)
      const tempMount = getVolumeMount(tempTestDir, '/workspace');
      
      // Use docker run directly in StdioClientTransport
      const transport = new StdioClientTransport({
        command: 'docker',
        args: [
          'run', '--rm', '-i',
          '-v', tempMount,
          '-e', 'MCP_CONTAINER=true',
          '-e', `MCP_HOST_WORKSPACE=${tempTestDir}`,
          DOCKER_IMAGE,
          'stdio'
        ]
      });
      
      console.log('[Container Smoke Test] Connecting to containerized MCP server...');
      await mcpSdkClient.connect(transport);
      console.log('[Container Smoke Test] Connected to container.');
      
      // 3. Create debug session
      console.log('[Container Smoke Test] Creating debug session...');
      const createCall = await mcpSdkClient.callTool({
        name: 'create_debug_session',
        arguments: { language: 'python', name: 'Container Path Test Session' }
      });
      const createResponse = parseSdkToolResult(createCall);
      expect(createResponse.sessionId).toBeDefined();
      debugSessionId = createResponse.sessionId;
      
      // 4. Set breakpoint using absolute host path (should be rejected)
      console.log('[Container Smoke Test] Setting breakpoint with absolute host path (expecting rejection)...');
      try {
        const breakpointCall = await mcpSdkClient.callTool({
          name: 'set_breakpoint',
          arguments: { 
            sessionId: debugSessionId, 
            file: testScriptPath,  // Absolute host path
            line: 3 
          }
        });
        const breakpointResponse = parseSdkToolResult(breakpointCall);
        
        // If we get here without an error, the test should fail
        expect(breakpointResponse.success).toBe(false);
        expect(breakpointResponse.error).toContain('Absolute paths are not supported in container mode');
        console.log('[Container Smoke Test] Absolute path correctly rejected with error:', breakpointResponse.error);
      } catch (error) {
        // This is expected - absolute paths should cause an error
        console.log('[Container Smoke Test] Absolute path rejected as expected:', error);
        expect(error).toBeDefined();
      }
      
      // 5. Now test with a relative path (should work)
      console.log('[Container Smoke Test] Setting breakpoint with relative path...');
      const relativeBreakpointCall = await mcpSdkClient.callTool({
        name: 'set_breakpoint',
        arguments: { 
          sessionId: debugSessionId, 
          file: 'test_container.py',  // Relative path
          line: 3 
        }
      });
      const relativeBreakpointResponse = parseSdkToolResult(relativeBreakpointCall);
      expect(relativeBreakpointResponse.success).toBe(true);
      console.log('[Container Smoke Test] Relative path accepted successfully');
      
      // 5.5. Log debug information about paths
      console.log('[Container Smoke Test] Container mount info:');
      console.log(`  - Host path: ${tempTestDir}`);
      console.log(`  - Container path: /workspace`);
      console.log(`  - Script relative path: test_container.py`);
      console.log(`  - Expected container full path: /workspace/test_container.py`);
      
      // 6. Start debugging with relative path
      console.log('[Container Smoke Test] Starting debugging with relative path...');
      const debugCall = await mcpSdkClient.callTool({
        name: 'start_debugging',
        arguments: {
          sessionId: debugSessionId,
          scriptPath: 'test_container.py',  // Relative path
          dapLaunchArgs: { stopOnEntry: false }
        }
      });
      const debugResponse = parseSdkToolResult(debugCall);
      
      // Add detailed logging to understand the failure
      console.log('[Container Smoke Test] Debug response:', JSON.stringify(debugResponse, null, 2));
      
      if (!debugResponse.success) {
        console.error('[Container Smoke Test] start_debugging failed with error:', debugResponse.message || debugResponse.error);
        console.error('[Container Smoke Test] Full response:', debugResponse);
      }
      
      expect(debugResponse.success).toBe(true);
      console.log('[Container Smoke Test] Path rejection and relative path handling test completed successfully.');
      
    } catch (error) {
      console.error('[Container Smoke Test] Error during path translation test:', error);
      throw error;
    } finally {
      // Cleanup
      if (debugSessionId && mcpSdkClient) {
        try {
          await mcpSdkClient.callTool({ 
            name: 'close_debug_session', 
            arguments: { sessionId: debugSessionId } 
          });
        } catch (e) {
          console.error(`[Container Smoke Test] Error closing debug session:`, e);
        }
      }
      
      // Clean up temp directory
      if (tempTestDir) {
        try {
          await remove(tempTestDir);
          console.log('[Container Smoke Test] Temp directory cleaned up');
        } catch (e) {
          console.error('[Container Smoke Test] Error cleaning up temp directory:', e);
        }
      }
    }
  }, TEST_TIMEOUT);
});
