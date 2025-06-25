/**
 * @jest-environment node
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  executeDebugSequence,
  waitForPort
} from './smoke-test-utils.js';

const TEST_TIMEOUT = 30000; // 30 seconds for SSE tests

let mcpSdkClient: Client | null = null;
let sseServerProcess: ChildProcess | null = null;
let serverPort: number | null = null;
const projectRoot = process.cwd();

describe('MCP Server E2E SSE Smoke Test', () => {
  // Ensure server is killed even if test fails
  afterEach(async () => {
    console.log('[SSE Smoke Test] Cleaning up...');
    
    // Close MCP client
    if (mcpSdkClient) {
      try {
        await mcpSdkClient.close();
        console.log('[SSE Smoke Test] MCP client closed');
      } catch (e) {
        console.error('[SSE Smoke Test] Error closing MCP client:', e);
      }
      mcpSdkClient = null;
    }
    
    // Kill SSE server process
    if (sseServerProcess) {
      try {
        sseServerProcess.kill();
        console.log('[SSE Smoke Test] SSE server process killed');
        // Wait a bit for process to fully terminate
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) {
        console.error('[SSE Smoke Test] Error killing SSE server:', e);
      }
      sseServerProcess = null;
    }
    
    serverPort = null;
  });

  async function startSSEServer(): Promise<number> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      
      // Use a random port in a safe range instead of port 0
      const port = Math.floor(Math.random() * (65535 - 49152)) + 49152;
      console.log(`[SSE Smoke Test] Starting SSE server on port ${port}...`);
      
      // Start server with specific port
      sseServerProcess = spawn('node', [
        path.join(projectRoot, 'dist', 'index.js'),
        'sse',
        '-p', port.toString(),
        '--log-level', 'debug'
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Timeout waiting for SSE server to start on port ${port}`));
        }
      }, 15000);
      
      // Buffer to accumulate output
      let outputBuffer = '';
      let hasOutput = false;
      
      // Listen for server output to confirm it started
      const handleOutput = (data: Buffer) => {
        const output = data.toString();
        outputBuffer += output;
        hasOutput = true;
        console.log('[SSE Server Output]', output.trim());
        
        if (!resolved && (outputBuffer.includes('listening') || outputBuffer.includes('started'))) {
          resolved = true;
          clearTimeout(timeout);
          console.log(`[SSE Smoke Test] Server confirmed started on port ${port}`);
          resolve(port);
        }
      };
      
      sseServerProcess.stdout?.on('data', handleOutput);
      sseServerProcess.stderr?.on('data', handleOutput);
      
      // If we don't get any output within 2 seconds, assume server started and check health
      setTimeout(() => {
        if (!resolved && !hasOutput) {
          console.log('[SSE Smoke Test] No server output detected, checking health endpoint...');
          resolved = true;
          clearTimeout(timeout);
          resolve(port);
        }
      }, 2000);
      
      sseServerProcess.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      });
      
      sseServerProcess.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`SSE server exited with code ${code}`));
        }
      });
    });
  }

  it('should successfully debug fibonacci.py via SSE transport', async () => {
    let debugSessionId: string | undefined;
    
    try {
      // 1. Start SSE server
      serverPort = await startSSEServer();
      
      // 2. Wait for server to be ready
      const serverReady = await waitForPort(serverPort);
      expect(serverReady).toBe(true);
      
      // 3. Create MCP client and connect using SSE transport
      console.log('[SSE Smoke Test] Connecting MCP SDK client via SSE...');
      mcpSdkClient = new Client({ 
        name: "e2e-sse-smoke-test-client", 
        version: "0.1.0" 
      });
      
      const sseUrl = new URL(`http://localhost:${serverPort}/sse`);
      const transport = new SSEClientTransport(sseUrl);
      
      await mcpSdkClient.connect(transport);
      console.log('[SSE Smoke Test] MCP SDK Client connected via SSE.');

      // 4. Execute debug sequence
      const fibonacciPath = path.join(projectRoot, 'examples', 'python', 'fibonacci.py');
      const result = await executeDebugSequence(
        mcpSdkClient,
        fibonacciPath,
        'E2E SSE Smoke Test Session'
      );
      
      expect(result.success).toBe(true);
      debugSessionId = result.sessionId;
      console.log('[SSE Smoke Test] Debug sequence completed successfully.');
      
    } catch (error) {
      console.error('[SSE Smoke Test] Unexpected error during test execution:', error);
      throw error;
    } finally {
      // 5. Cleanup
      if (debugSessionId && mcpSdkClient) {
        try {
          await mcpSdkClient.callTool({ 
            name: 'close_debug_session', 
            arguments: { sessionId: debugSessionId } 
          });
          console.log(`[SSE Smoke Test] Debug session ${debugSessionId} closed.`);
        } catch (e) {
          console.error(`[SSE Smoke Test] Error closing debug session ${debugSessionId}:`, e);
        }
      }
    }
  }, TEST_TIMEOUT);

  // Test spawning the server from a different working directory
  it('should work when SSE server is spawned from different working directory', async () => {
    const tempDir = os.tmpdir();
    console.log(`[SSE Smoke Test] Will spawn server with cwd: ${tempDir}`);
    
    let debugSessionId: string | undefined;
    
    try {
      // Start SSE server from temp directory
      console.log('[SSE Smoke Test] Starting SSE server from temp directory...');
      
      serverPort = await new Promise<number>((resolve, reject) => {
        let resolved = false;
        
        // Use a random port in a safe range
        const port = Math.floor(Math.random() * (65535 - 49152)) + 49152;
        console.log(`[SSE Smoke Test] Starting SSE server on port ${port} from temp directory...`);
        
        sseServerProcess = spawn('node', [
          path.join(projectRoot, 'dist', 'index.js'),
          'sse',
          '-p', port.toString(),
          '--log-level', 'debug'
        ], {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: tempDir, // Spawn from temp directory
          env: {
            ...process.env,
            MCP_DEBUG_PROJECT_ROOT: projectRoot
          }
        });
        
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            reject(new Error(`Timeout waiting for SSE server to start on port ${port}`));
          }
        }, 15000);
        
        // Buffer to accumulate output
        let outputBuffer = '';
        let hasOutput = false;
        
        // Listen for server output to confirm it started
        const handleOutput = (data: Buffer) => {
          const output = data.toString();
          outputBuffer += output;
          hasOutput = true;
          console.log('[SSE Server Output]', output.trim());
          
          if (!resolved && (outputBuffer.includes('listening') || outputBuffer.includes('started'))) {
            resolved = true;
            clearTimeout(timeout);
            console.log(`[SSE Smoke Test] Server confirmed started on port ${port}`);
            resolve(port);
          }
        };
        
        sseServerProcess.stdout?.on('data', handleOutput);
        sseServerProcess.stderr?.on('data', handleOutput);
        
        // If we don't get any output within 2 seconds, assume server started and check health
        setTimeout(() => {
          if (!resolved && !hasOutput) {
            console.log('[SSE Smoke Test] No server output detected, checking health endpoint...');
            resolved = true;
            clearTimeout(timeout);
            resolve(port);
          }
        }, 2000);
        
        sseServerProcess.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(err);
          }
        });
        
        sseServerProcess.on('exit', (code) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(new Error(`SSE server exited with code ${code}`));
          }
        });
      });
      
      console.log(`[SSE Smoke Test] Server started on port ${serverPort} from temp directory`);
      
      // Wait for server to be ready
      const serverReady = await waitForPort(serverPort);
      expect(serverReady).toBe(true);
      
      // Create MCP client and connect
      console.log('[SSE Smoke Test] Connecting MCP SDK client via SSE...');
      mcpSdkClient = new Client({ 
        name: "e2e-sse-smoke-test-client-tempdir", 
        version: "0.1.0" 
      });
      
      const sseUrl = new URL(`http://localhost:${serverPort}/sse`);
      const transport = new SSEClientTransport(sseUrl);
      
      await mcpSdkClient.connect(transport);
      console.log('[SSE Smoke Test] MCP SDK Client connected via SSE from temp directory.');

      // Execute debug sequence
      const fibonacciPath = path.join(projectRoot, 'examples', 'python', 'fibonacci.py');
      const result = await executeDebugSequence(
        mcpSdkClient,
        fibonacciPath,
        'E2E SSE Smoke Test Session (Temp Dir)'
      );
      
      expect(result.success).toBe(true);
      debugSessionId = result.sessionId;
      console.log('[SSE Smoke Test] Debug sequence completed successfully from temp directory.');

    } catch (error) {
      console.error('[SSE Smoke Test] Error during test execution from temp directory:', error);
      throw error;
    } finally {
      // Cleanup
      if (debugSessionId && mcpSdkClient) {
        try {
          await mcpSdkClient.callTool({ 
            name: 'close_debug_session', 
            arguments: { sessionId: debugSessionId } 
          });
          console.log(`[SSE Smoke Test] Debug session ${debugSessionId} closed.`);
        } catch (e) {
          console.error(`[SSE Smoke Test] Error closing debug session ${debugSessionId}:`, e);
        }
      }
    }
  }, TEST_TIMEOUT);
});
