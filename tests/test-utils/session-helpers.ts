import { DebugMcpServer } from '../../src/server';
import { createLogger } from '../../src/utils/logger';
import { DebugSessionInfo, DebugLanguage, Breakpoint, Variable, StackFrame } from '../../src/session/models';
import { DebugProtocol } from '@vscode/debugprotocol';

// Create a logger for the test helpers
const logger = createLogger('debug-mcp:test-helpers');

// Instantiate the DebugMcpServer once for all tests using these helpers
// This ensures a consistent server instance and avoids re-initializing it for every test
const debugServer = new DebugMcpServer({
  logLevel: 'debug', // Set a detailed log level for tests
  logFile: 'integration_test_server_real_discovery.log' // Direct logs to the specific file
});

// Helper to create a debug session
export async function createDebugSession(params: { language: DebugLanguage; name?: string; pythonPath?: string; }): Promise<DebugSessionInfo> {
  logger.info(`[Test Helper] Calling createDebugSession with language: ${params.language}, name: ${params.name || 'unnamed'}, pythonPath: ${params.pythonPath || 'none'}`);
  return debugServer.createDebugSession(params);
}

// Helper to start debugging
export async function startDebugging(
  sessionId: string, 
  scriptPath: string, 
  args?: string[], 
  dapLaunchArgs?: Partial<DebugProtocol.LaunchRequestArguments>, 
  dryRunSpawn?: boolean
): Promise<{ success: boolean; state: string; error?: string; data?: unknown; }> {
  logger.info(`[Test Helper] Calling startDebugging for session: ${sessionId}, script: ${scriptPath}, dryRun: ${dryRunSpawn}`);
  return debugServer.startDebugging(sessionId, scriptPath, args, dapLaunchArgs, dryRunSpawn);
}

// Helper to close a debug session
export async function closeDebugSession(sessionId: string): Promise<boolean> {
  logger.info(`[Test Helper] Calling closeDebugSession for session: ${sessionId}`);
  return debugServer.closeDebugSession(sessionId);
}

// Helper to set a breakpoint
export async function setBreakpoint(sessionId: string, file: string, line: number, condition?: string): Promise<Breakpoint> {
  logger.info(`[Test Helper] Calling setBreakpoint for session: ${sessionId}, file: ${file}, line: ${line}`);
  return debugServer.setBreakpoint(sessionId, file, line, condition);
}

// Helper to get variables
export async function getVariables(sessionId: string, scope: number): Promise<Variable[]> {
  logger.info(`[Test Helper] Calling getVariables for session: ${sessionId}, scope: ${scope}`);
  return debugServer.getVariables(sessionId, scope);
}

// Helper to get stack trace
export async function getStackTrace(sessionId: string): Promise<StackFrame[]> {
  logger.info(`[Test Helper] Calling getStackTrace for session: ${sessionId}`);
  return debugServer.getStackTrace(sessionId);
}

// Helper to get scopes
export async function getScopes(sessionId: string, frameId: number): Promise<DebugProtocol.Scope[]> {
  logger.info(`[Test Helper] Calling getScopes for session: ${sessionId}, frameId: ${frameId}`);
  return debugServer.getScopes(sessionId, frameId);
}

// Helper to continue execution
export async function continueExecution(sessionId: string): Promise<boolean> {
  logger.info(`[Test Helper] Calling continueExecution for session: ${sessionId}`);
  return debugServer.continueExecution(sessionId);
}

// Helper to step over
export async function stepOver(sessionId: string): Promise<boolean> {
  logger.info(`[Test Helper] Calling stepOver for session: ${sessionId}`);
  return debugServer.stepOver(sessionId);
}

// Helper to step into
export async function stepInto(sessionId: string): Promise<boolean> {
  logger.info(`[Test Helper] Calling stepInto for session: ${sessionId}`);
  return debugServer.stepInto(sessionId);
}

// Helper to step out
export async function stepOut(sessionId: string): Promise<boolean> {
  logger.info(`[Test Helper] Calling stepOut for session: ${sessionId}`);
  return debugServer.stepOut(sessionId);
}

// Export the server instance for direct access if needed (e.g., for `beforeAll`/`afterAll` hooks)
export { debugServer };
