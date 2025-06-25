/**
 * Shared utilities for smoke tests
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ServerResult } from '@modelcontextprotocol/sdk/types.js';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

/**
 * Parse SDK tool results
 */
export interface ParsedToolResult {
  sessionId?: string;
  success?: boolean;
  state?: string;
  [key: string]: unknown;
}

export const parseSdkToolResult = (rawResult: ServerResult): ParsedToolResult => {
  const contentArray = (rawResult as { content?: Array<{ type: string; text: string }> }).content;
  if (!contentArray || !Array.isArray(contentArray) || contentArray.length === 0 || contentArray[0].type !== 'text') {
    console.error("Invalid ServerResult structure received from SDK:", rawResult);
    throw new Error('Invalid ServerResult structure from SDK or missing text content');
  }
  return JSON.parse(contentArray[0].text);
};

/**
 * Execute common debug sequence for smoke tests
 */
export async function executeDebugSequence(
  mcpSdkClient: Client,
  fibonacciPath: string,
  sessionName: string
): Promise<{ sessionId: string; success: boolean }> {
  let debugSessionId: string | undefined;
  
  try {
    // 1. Create debug session
    console.log(`[Smoke Test] Creating debug session: ${sessionName}...`);
    const createCall = await mcpSdkClient.callTool({
      name: 'create_debug_session',
      arguments: { language: 'python', name: sessionName }
    });
    const createToolResponse = parseSdkToolResult(createCall);
    if (!createToolResponse.sessionId) {
      throw new Error('Failed to create debug session');
    }
    debugSessionId = createToolResponse.sessionId;
    console.log(`[Smoke Test] Debug session created: ${debugSessionId}`);

    // 2. Set breakpoint
    console.log('[Smoke Test] Setting breakpoint...');
    const breakpointCall = await mcpSdkClient.callTool({
      name: 'set_breakpoint',
      arguments: { sessionId: debugSessionId, file: fibonacciPath, line: 32 }
    });
    const breakpointResponse = parseSdkToolResult(breakpointCall);
    if (!breakpointResponse.success) {
      throw new Error('Failed to set breakpoint');
    }
    console.log('[Smoke Test] Breakpoint set.');

    // 3. Start debugging
    console.log('[Smoke Test] Starting debugging...');
    const debugCall = await mcpSdkClient.callTool({
      name: 'start_debugging',
      arguments: {
        sessionId: debugSessionId,
        scriptPath: fibonacciPath,
        dapLaunchArgs: { stopOnEntry: true }
      }
    });
    const debugResponse = parseSdkToolResult(debugCall);
    if (!debugResponse.success) {
      throw new Error(`Failed to start debugging: ${JSON.stringify(debugResponse)}`);
    }
    console.log(`[Smoke Test] Debugging started successfully. State: ${debugResponse.state}`);
    
    return { sessionId: debugSessionId, success: true };
  } catch (error) {
    console.error('[Smoke Test] Error during debug sequence:', error);
    // Clean up on error
    if (debugSessionId) {
      try {
        await mcpSdkClient.callTool({ 
          name: 'close_debug_session', 
          arguments: { sessionId: debugSessionId } 
        });
      } catch (e) {
        console.error(`[Smoke Test] Error closing debug session ${debugSessionId}:`, e);
      }
    }
    throw error;
  }
}

/**
 * Check if Docker is available on the system
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const result = await execWithTimeout('docker --version', 5000);
    console.log('[Smoke Test] Docker version:', result.stdout.trim());
    return true;
  } catch (error) {
    console.log('[Smoke Test] Docker not available:', error);
    return false;
  }
}

/**
 * Execute command with timeout
 */
export async function execWithTimeout(command: string, timeoutMs: number = 30000): Promise<{ stdout: string; stderr: string }> {
  return Promise.race([
    exec(command),
    new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`)), timeoutMs)
    )
  ]);
}

/**
 * Wait for SSE server to be ready by checking health endpoint
 */
export async function waitForPort(port: number, timeout: number = 10000): Promise<boolean> {
  const startTime = Date.now();
  const healthUrl = `http://localhost:${port}/health`;
  console.log(`[Smoke Test] Waiting for SSE server health at ${healthUrl}...`);
  
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        const healthStatus = await response.json();
        if (healthStatus.status === 'ok') {
          console.log('[Smoke Test] SSE server health check passed');
          return true;
        }
      }
    } catch {
      // Connection refused, server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.error(`[Smoke Test] Timeout waiting for SSE server on port ${port}`);
  return false;
}

/**
 * Clean up Docker containers
 */
export async function cleanupDocker(containerId?: string): Promise<void> {
  if (!containerId) return;
  
  try {
    console.log(`[Smoke Test] Stopping Docker container ${containerId}...`);
    await execWithTimeout(`docker stop ${containerId}`, 10000);
    console.log(`[Smoke Test] Removing Docker container ${containerId}...`);
    await execWithTimeout(`docker rm ${containerId}`, 5000);
    console.log('[Smoke Test] Docker cleanup completed');
  } catch (error) {
    console.error('[Smoke Test] Error during Docker cleanup:', error);
    // Try force removal as fallback
    try {
      await execWithTimeout(`docker rm -f ${containerId}`, 5000);
    } catch (e) {
      console.error('[Smoke Test] Force removal also failed:', e);
    }
  }
}

/**
 * Get cross-platform volume mount string
 */
export function getVolumeMount(hostPath: string, containerPath: string): string {
  // On Windows, convert backslashes to forward slashes for Docker
  const normalizedHostPath = process.platform === 'win32' 
    ? hostPath.replace(/\\/g, '/')
    : hostPath;
  
  return `${normalizedHostPath}:${containerPath}`;
}

/**
 * Generate unique container name to avoid conflicts
 */
export function generateContainerName(prefix: string = 'mcp-debug-test'): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substr(2, 9);
  return `${prefix}-${timestamp}-${randomSuffix}`;
}

/**
 * Get Docker container logs for debugging
 */
export async function getContainerLogs(containerId: string): Promise<string> {
  try {
    const result = await execWithTimeout(`docker logs ${containerId}`, 5000);
    return result.stdout + result.stderr;
  } catch (error) {
    console.error('[Smoke Test] Failed to get container logs:', error);
    return 'Failed to retrieve container logs';
  }
}

/**
 * Extract port from SSE server output
 */
export function extractPortFromOutput(output: string): number | null {
  // Look for patterns like:
  // - "listening on port 3000"
  // - "Server started on port: 3000"
  // - "Debug MCP Server (SSE) listening on port 3000"
  const portMatch = output.match(/listening\s+on\s+port\s+(\d+)/i);
  if (portMatch && portMatch[1]) {
    return parseInt(portMatch[1], 10);
  }
  return null;
}

/**
 * Check if Docker image exists
 */
export async function dockerImageExists(imageName: string): Promise<boolean> {
  try {
    const result = await execWithTimeout(`docker images -q ${imageName}`, 5000);
    return result.stdout.trim().length > 0;
  } catch (error) {
    console.error('[Smoke Test] Error checking Docker image:', error);
    return false;
  }
}

/**
 * Build Docker image if needed
 */
export async function ensureDockerImage(imageName: string, forceBuild: boolean = true): Promise<void> {
  const exists = await dockerImageExists(imageName);
  
  if (exists && !forceBuild) {
    console.log(`[Smoke Test] Docker image ${imageName} already exists, skipping build`);
    return;
  }
  
  console.log(`[Smoke Test] Building Docker image ${imageName}...`);
  const buildResult = await execWithTimeout(
    `docker build --no-cache -t ${imageName} .`,
    120000 // 2 minutes timeout for build
  );
  
  if (buildResult.stderr && !buildResult.stderr.includes('Successfully built')) {
    console.warn('[Smoke Test] Docker build warnings:', buildResult.stderr);
  }
  
  console.log(`[Smoke Test] Docker image ${imageName} built successfully`);
}
