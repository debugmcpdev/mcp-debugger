import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';

// DO NOT mock Python discovery - we want to test the real implementation
// This test should fail on Windows if python3 is the Microsoft Store redirect

describe('Python Discovery - Real Implementation Test', () => {
  let client: Client | null = null;

  beforeAll(async () => {
    const currentFileURL = import.meta.url;
    const currentFilePath = fileURLToPath(currentFileURL);
    const currentDirName = path.dirname(currentFilePath);
    const serverScriptPath = path.resolve(currentDirName, '../../dist/index.js');

    client = new Client({
      name: "python-discovery-test-client",
      version: "0.1.0",
      capabilities: { tools: {} }
    });

    const filteredEnv: Record<string, string> = {};
    for (const key in process.env) {
      if (process.env[key] !== undefined) {
        filteredEnv[key] = process.env[key] as string;
      }
    }

    // Clear any Python-related environment variables to ensure we test discovery
    delete filteredEnv.PYTHON_PATH;
    delete filteredEnv.PYTHON_EXECUTABLE;

    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverScriptPath, '--log-level', 'debug'],
      env: filteredEnv,
    });

    try {
      await client.connect(transport);
    } catch (error) {
      console.error('[Test] Failed to connect to server:', error);
      throw error;
    }
  });

  afterAll(async () => {
    if (client) {
      try {
        await client.close();
      } catch (e) {
        console.error('[Test] Error closing client:', e);
      }
    }
  });

  it('should find Python on Windows without explicit path', async () => {
    // This test MUST NOT mock Python discovery
    // It should use the real findPythonExecutable function
    // On Windows, this should find 'py' or 'python' (not 'python3' which is often Microsoft Store)
    
    if (!client) {
      throw new Error("Client not initialized");
    }

    const parseToolResult = (rawResult: any) => {
      const anyResult = rawResult as any;
      if (!anyResult || !anyResult.content || !anyResult.content[0] || anyResult.content[0].type !== 'text') {
        console.error("Invalid ServerResult structure received:", rawResult);
        throw new Error('Invalid ServerResult structure');
      }
      return JSON.parse(anyResult.content[0].text);
    };

    // Create a debug session without specifying pythonPath
    // This forces the server to use Python discovery
    const createResult = parseToolResult(
      await client.callTool({ 
        name: 'create_debug_session', 
        arguments: { 
          language: 'python', 
          name: 'PythonDiscoveryTest'
          // NOTE: No pythonPath specified - must rely on discovery
        } 
      })
    );
    
    expect(createResult.success).toBe(true);
    const sessionId = createResult.sessionId;
    console.log(`[Test] Created session: ${sessionId}`);

    // Try to start debugging - this will trigger Python discovery
    const scriptPath = path.resolve('examples/python/fibonacci.py');
    const startResult = parseToolResult(
      await client.callTool({
        name: 'start_debugging',
        arguments: {
          sessionId,
          scriptPath,
          dryRunSpawn: true // Use dry run to avoid actually starting the debugger
        }
      })
    );

    // This should succeed if Python discovery works correctly
    expect(startResult.success).toBe(true);
    expect(startResult.data?.dryRun).toBe(true);
    
    // Clean up
    await client.callTool({ 
      name: 'close_debug_session', 
      arguments: { sessionId } 
    });
  });

  // Note: Testing error messages when Python is not found is covered in unit tests
  // where we can mock the environment. Integration tests run in environments where
  // Python is typically available, making it impractical to test this scenario here.
});
