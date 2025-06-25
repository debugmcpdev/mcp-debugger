/**
 * Debug MCP Server - Main Server Implementation
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode as McpErrorCode, 
  McpError,
  ServerResult, 
} from '@modelcontextprotocol/sdk/types.js';
import { SessionManager, SessionManagerConfig } from './session/session-manager.js';
import { createProductionDependencies } from './container/dependencies.js';
import { ContainerConfig } from './container/types.js';
import { 
    DebugSessionInfo, 
    Variable, 
    StackFrame, 
    DebugLanguage,
    Breakpoint 
} from './session/models.js';
import { DebugProtocol } from '@vscode/debugprotocol';
import path from 'path';
import { PathTranslator } from './utils/path-translator.js';

/**
 * Configuration options for the Debug MCP Server
 */
export interface DebugMcpServerOptions {
  logLevel?: string;
  logFile?: string;
  pathTranslator?: PathTranslator;
}

/**
 * Tool arguments interface
 */
interface ToolArguments {
  sessionId?: string;
  language?: string;
  name?: string;
  pythonPath?: string;
  file?: string;
  line?: number;
  condition?: string;
  scriptPath?: string;
  args?: string[];
  dapLaunchArgs?: Partial<DebugProtocol.LaunchRequestArguments>;
  dryRunSpawn?: boolean;
  scope?: number;
  frameId?: number;
  expression?: string;
  linesContext?: number;
}

/**
 * Main Debug MCP Server class
 */
export class DebugMcpServer {
  public server: Server;
  private sessionManager: SessionManager;
  private logger;
  private constructorOptions: DebugMcpServerOptions;
  private pathTranslator: PathTranslator;

  // Public methods to expose SessionManager functionality for testing/external use
  public async createDebugSession(params: { language: DebugLanguage; name?: string; pythonPath?: string; }): Promise<DebugSessionInfo> {
    if (params.language !== 'python') { 
      throw new McpError(McpErrorCode.InvalidParams, "language parameter must be 'python'");
    }
    const name = params.name || `Debug-${Date.now()}`;
    try {
      const sessionInfo: DebugSessionInfo = await this.sessionManager.createSession({
        language: params.language as DebugLanguage,
        name: name,
        pythonPath: params.pythonPath 
      });
      return sessionInfo;
    } catch (error) {
      const errorMessage = (error as Error).message || String(error);
      this.logger.error('Failed to create debug session', { error: errorMessage, stack: (error as Error).stack });
      throw new McpError(McpErrorCode.InternalError, `Failed to create debug session: ${errorMessage}`);
    }
  }

  public async startDebugging(
    sessionId: string, 
    scriptPath: string, 
    args?: string[], 
    dapLaunchArgs?: Partial<DebugProtocol.LaunchRequestArguments>, 
    dryRunSpawn?: boolean
  ): Promise<{ success: boolean; state: string; error?: string; data?: unknown; }> {
    const translatedScriptPath = this.pathTranslator.translatePath(scriptPath);
    this.logger.info(`[DebugMcpServer.startDebugging] Original scriptPath: ${scriptPath}, Translated scriptPath: ${translatedScriptPath}`);
    const result = await this.sessionManager.startDebugging(
      sessionId, 
      translatedScriptPath, 
      args, 
      dapLaunchArgs, 
      dryRunSpawn
    );
    return result;
  }

  public async closeDebugSession(sessionId: string): Promise<boolean> {
    return this.sessionManager.closeSession(sessionId);
  }

  public async setBreakpoint(sessionId: string, file: string, line: number, condition?: string): Promise<Breakpoint> {
    const translatedFile = this.pathTranslator.translatePath(file);
    this.logger.info(`[DebugMcpServer.setBreakpoint] Original file: ${file}, Translated file: ${translatedFile}`);
    return this.sessionManager.setBreakpoint(sessionId, translatedFile, line, condition);
  }

  public async getVariables(sessionId: string, variablesReference: number): Promise<Variable[]> {
    return this.sessionManager.getVariables(sessionId, variablesReference);
  }

  public async getStackTrace(sessionId: string): Promise<StackFrame[]> {
    const session = this.sessionManager.getSession(sessionId);
    const currentThreadId = session?.proxyManager?.getCurrentThreadId();
    if (!session || !session.proxyManager || !currentThreadId) {
        throw new McpError(McpErrorCode.InvalidRequest, "Cannot get stack trace: no active proxy, thread, or session not found/paused.");
    }
    return this.sessionManager.getStackTrace(sessionId, currentThreadId);
  }

  public async getScopes(sessionId: string, frameId: number): Promise<DebugProtocol.Scope[]> {
    return this.sessionManager.getScopes(sessionId, frameId);
  }

  public async continueExecution(sessionId: string): Promise<boolean> {
    const result = await this.sessionManager.continue(sessionId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to continue execution');
    }
    return true;
  }

  public async stepOver(sessionId: string): Promise<boolean> {
    const result = await this.sessionManager.stepOver(sessionId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to step over');
    }
    return true;
  }

  public async stepInto(sessionId: string): Promise<boolean> {
    const result = await this.sessionManager.stepInto(sessionId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to step into');
    }
    return true;
  }

  public async stepOut(sessionId: string): Promise<boolean> {
    const result = await this.sessionManager.stepOut(sessionId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to step out');
    }
    return true;
  }

  constructor(options: DebugMcpServerOptions = {}) {
    this.constructorOptions = options;
    
    const containerConfig: ContainerConfig = {
      logLevel: options.logLevel,
      logFile: options.logFile,
      sessionLogDirBase: options.logFile ? path.dirname(options.logFile) + '/sessions' : undefined
    };
    
    const dependencies = createProductionDependencies(containerConfig);
    
    this.logger = dependencies.logger;
    this.logger.info('[DebugMcpServer Constructor] Main server logger instance assigned.');

    this.server = new Server(
      { name: 'debug-mcp-server', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    const sessionManagerConfig: SessionManagerConfig = {
      logDirBase: containerConfig.sessionLogDirBase
    };
    
    this.sessionManager = new SessionManager(sessionManagerConfig, dependencies);
    this.pathTranslator = options.pathTranslator || new PathTranslator(dependencies.fileSystem, dependencies.logger, dependencies.environment); // Pass fileSystem, logger, and environment

    this.registerTools();
    this.server.onerror = (error) => {
      this.logger.error('Server error', { error });
    };
  }

  /**
   * Sanitize request data for logging (remove sensitive information)
   */
  private sanitizeRequest(args: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...args };
    // Remove absolute paths from pythonPath
    if (sanitized.pythonPath && typeof sanitized.pythonPath === 'string' && path.isAbsolute(sanitized.pythonPath)) {
      sanitized.pythonPath = '<absolute-path>';
    }
    // Truncate long arrays
    if (sanitized.args && Array.isArray(sanitized.args) && sanitized.args.length > 5) {
      sanitized.args = [...sanitized.args.slice(0, 5), `... +${sanitized.args.length - 5} more`];
    }
    return sanitized;
  }

  /**
   * Get session name for logging
   */
  private getSessionName(sessionId: string): string {
    try {
      const session = this.sessionManager.getSession(sessionId);
      return session?.name || 'Unknown Session';
    } catch {
      return 'Unknown Session';
    }
  }

  private getPathDescription(parameterName: string): string {
    const isContainer = this.pathTranslator.isContainerMode();
    // Get workspace root from PathTranslator to respect dependency injection
    const cwd = this.pathTranslator.getWorkspaceRoot();
    
    if (isContainer) {
      return `Path to the ${parameterName} (relative to /workspace mount point). Example: 'src/main.py'`;
    } else {
      const examplePath = path.join(cwd, 'src', 'main.py').replace(/\\/g, '/');
      return `Path to the ${parameterName} (absolute or relative to server's working directory: ${cwd}). Examples: 'src/main.py' or '${examplePath}'`;
    }
  }

  private registerTools(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logger.debug('Handling ListToolsRequest');
      
      // Generate dynamic descriptions for path parameters
      const fileDescription = this.getPathDescription('source file');
      const scriptPathDescription = this.getPathDescription('script');
      
      return {
        tools: [
          { name: 'create_debug_session', description: 'Create a new debugging session', inputSchema: { type: 'object', properties: { language: { type: 'string', enum: ['python'] }, name: { type: 'string' }, pythonPath: {type: 'string'}, host: {type: 'string'}, port: {type: 'number'} }, required: ['language'] } },
          { name: 'list_debug_sessions', description: 'List all active debugging sessions', inputSchema: { type: 'object', properties: {} } },
          { name: 'set_breakpoint', description: 'Set a breakpoint. Setting breakpoints on non-executable lines (structural, declarative) may lead to unexpected behavior', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, file: { type: 'string', description: fileDescription }, line: { type: 'number', description: 'Line number where to set breakpoint. Executable statements (assignments, function calls, conditionals, returns) work best. Structural lines (function/class definitions), declarative lines (imports), or non-executable lines (comments, blank lines) may cause unexpected stepping behavior' }, condition: { type: 'string' } }, required: ['sessionId', 'file', 'line'] } },
          { name: 'start_debugging', description: 'Start debugging a script', inputSchema: { 
              type: 'object', 
              properties: { 
                sessionId: { type: 'string' }, 
                scriptPath: { type: 'string', description: scriptPathDescription }, 
                args: { type: 'array', items: { type: 'string' } }, 
                dapLaunchArgs: { 
                  type: 'object', 
                  properties: { 
                    stopOnEntry: { type: 'boolean' },
                    justMyCode: { type: 'boolean' } 
                  },
                  additionalProperties: true
                },
                dryRunSpawn: { type: 'boolean' } 
              }, 
              required: ['sessionId', 'scriptPath'] 
            } 
          },
          { name: 'close_debug_session', description: 'Close a debugging session', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } },
          { name: 'step_over', description: 'Step over', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } },
          { name: 'step_into', description: 'Step into', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } },
          { name: 'step_out', description: 'Step out', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } },
          { name: 'continue_execution', description: 'Continue execution', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } },
          { name: 'pause_execution', description: 'Pause execution (Not Implemented)', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } },
          { name: 'get_variables', description: 'Get variables (scope is variablesReference: number)', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, scope: { type: 'number', description: "The variablesReference number from a StackFrame or Variable" } }, required: ['sessionId', 'scope'] } },
          { name: 'get_stack_trace', description: 'Get stack trace', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } },
          { name: 'get_scopes', description: 'Get scopes for a stack frame', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, frameId: { type: 'number', description: "The ID of the stack frame from a stackTrace response" } }, required: ['sessionId', 'frameId'] } },
          { name: 'evaluate_expression', description: 'Evaluate expression (Not Implemented)', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, expression: { type: 'string' } }, required: ['sessionId', 'expression'] } },
          { name: 'get_source_context', description: 'Get source context (Not Implemented)', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, file: { type: 'string', description: fileDescription }, line: { type: 'number' }, linesContext: { type: 'number' } }, required: ['sessionId', 'file', 'line'] } },
        ],
      };
    });

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request): Promise<ServerResult> => {
        const toolName = request.params.name;
        const args = request.params.arguments as ToolArguments; 

        // Log tool call with structured logging
        this.logger.info('tool:call', {
          tool: toolName,
          sessionId: args.sessionId,
          sessionName: args.sessionId ? this.getSessionName(args.sessionId) : undefined,
          request: this.sanitizeRequest(args as Record<string, unknown>),
          timestamp: Date.now()
        });

        try {
          let result: ServerResult;
          
          switch (toolName) {
            case 'create_debug_session': {
              const sessionInfo = await this.createDebugSession({
                language: (args.language || 'python') as DebugLanguage,
                name: args.name,
                pythonPath: args.pythonPath
              });
              
              // Log session creation
              this.logger.info('session:created', {
                sessionId: sessionInfo.id,
                sessionName: sessionInfo.name,
                language: sessionInfo.language,
                pythonPath: args.pythonPath,
                timestamp: Date.now()
              });
              
              result = { content: [{ type: 'text', text: JSON.stringify({ success: true, sessionId: sessionInfo.id, message: `Created ${sessionInfo.language} debug session: ${sessionInfo.name}` }) }] };
              break;
            }
            case 'list_debug_sessions': {
              result = await this.handleListDebugSessions();
              break;
            }
            case 'set_breakpoint': {
              if (!args.sessionId || !args.file || args.line === undefined) {
                throw new McpError(McpErrorCode.InvalidParams, 'Missing required parameters');
              }
              const breakpoint = await this.setBreakpoint(args.sessionId, args.file, args.line, args.condition);
              
              // Log breakpoint event
              this.logger.info('debug:breakpoint', {
                event: 'set',
                sessionId: args.sessionId,
                sessionName: this.getSessionName(args.sessionId),
                breakpointId: breakpoint.id,
                file: breakpoint.file,
                line: breakpoint.line,
                verified: breakpoint.verified,
                timestamp: Date.now()
              });
              
              result = { content: [{ type: 'text', text: JSON.stringify({ success: true, breakpointId: breakpoint.id, file: breakpoint.file, line: breakpoint.line, verified: breakpoint.verified, message: `Breakpoint set at ${breakpoint.file}:${breakpoint.line}` }) }] };
              break;
            }
            case 'start_debugging': {
              if (!args.sessionId || !args.scriptPath) {
                throw new McpError(McpErrorCode.InvalidParams, 'Missing required parameters');
              }
              const debugResult = await this.startDebugging(args.sessionId, args.scriptPath, args.args, args.dapLaunchArgs, args.dryRunSpawn);
              const responsePayload: Record<string, unknown> = {
                success: debugResult.success,
                state: debugResult.state,
                message: debugResult.error ? debugResult.error : (debugResult.data as Record<string, unknown>)?.message || `Operation status for ${args.scriptPath}`,
              };
              if (debugResult.data) {
                responsePayload.data = debugResult.data;
              }
              result = { content: [{ type: 'text', text: JSON.stringify(responsePayload) }] };
              break;
            }
            case 'close_debug_session': {
              if (!args.sessionId) {
                throw new McpError(McpErrorCode.InvalidParams, 'Missing required sessionId');
              }
              
              const sessionName = this.getSessionName(args.sessionId);
              const sessionCreatedAt = Date.now(); // In real implementation, would track creation time
              const closed = await this.closeDebugSession(args.sessionId);
              
              if (closed) {
                // Log session closure
                this.logger.info('session:closed', {
                  sessionId: args.sessionId,
                  sessionName: sessionName,
                  duration: Date.now() - sessionCreatedAt,
                  timestamp: Date.now()
                });
              }
              
              result = { content: [{ type: 'text', text: JSON.stringify({ success: closed, message: closed ? `Closed debug session: ${args.sessionId}` : `Failed to close debug session: ${args.sessionId}` }) }] };
              break;
            }
            case 'step_over':
            case 'step_into':
            case 'step_out': {
              if (!args.sessionId) {
                throw new McpError(McpErrorCode.InvalidParams, 'Missing required sessionId');
              }
              let stepResult: boolean;
              if (toolName === 'step_over') {
                stepResult = await this.stepOver(args.sessionId);
              } else if (toolName === 'step_into') {
                stepResult = await this.stepInto(args.sessionId);
              } else {
                stepResult = await this.stepOut(args.sessionId);
              }
              result = { content: [{ type: 'text', text: JSON.stringify({ success: stepResult, message: stepResult ? `Stepped ${toolName.replace('step_', '')}` : `Failed to ${toolName.replace('_', ' ')}` }) }] };
              break;
            }
            case 'continue_execution': {
              if (!args.sessionId) {
                throw new McpError(McpErrorCode.InvalidParams, 'Missing required sessionId');
              }
              const continueResult = await this.continueExecution(args.sessionId);
              result = { content: [{ type: 'text', text: JSON.stringify({ success: continueResult, message: continueResult ? 'Continued execution' : 'Failed to continue execution' }) }] };
              break;
            }
            case 'pause_execution': {
              result = await this.handlePause(args as { sessionId: string });
              break;
            }
            case 'get_variables': {
              if (!args.sessionId || args.scope === undefined) {
                throw new McpError(McpErrorCode.InvalidParams, 'Missing required parameters');
              }
              const variables = await this.getVariables(args.sessionId, args.scope);
              
              // Log variable inspection (truncate large values)
              const truncatedVars = variables.map(v => ({
                name: v.name,
                type: v.type,
                value: v.value.length > 200 ? v.value.substring(0, 200) + '... (truncated)' : v.value
              }));
              
              this.logger.info('debug:variables', {
                sessionId: args.sessionId,
                sessionName: this.getSessionName(args.sessionId),
                variablesReference: args.scope,
                variableCount: variables.length,
                variables: truncatedVars.slice(0, 10), // Log first 10 variables
                timestamp: Date.now()
              });
              
              result = { content: [{ type: 'text', text: JSON.stringify({ success: true, variables, count: variables.length, variablesReference: args.scope }) }] };
              break;
            }
            case 'get_stack_trace': {
              if (!args.sessionId) {
                throw new McpError(McpErrorCode.InvalidParams, 'Missing required sessionId');
              }
              const stackFrames = await this.getStackTrace(args.sessionId);
              result = { content: [{ type: 'text', text: JSON.stringify({ success: true, stackFrames, count: stackFrames.length }) }] };
              break;
            }
            case 'get_scopes': {
              if (!args.sessionId || args.frameId === undefined) {
                throw new McpError(McpErrorCode.InvalidParams, 'Missing required parameters');
              }
              const scopes = await this.getScopes(args.sessionId, args.frameId);
              result = { content: [{ type: 'text', text: JSON.stringify({ success: true, scopes }) }] };
              break;
            }
            case 'evaluate_expression': {
              result = await this.handleEvaluateExpression(args as { sessionId: string; expression: string });
              break;
            }
            case 'get_source_context': {
              result = await this.handleGetSourceContext(args as { sessionId: string; file: string; line: number; linesContext?: number });
              break;
            }
            default:
              throw new McpError(McpErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
          }
          
          // Log successful tool response
          this.logger.info('tool:response', {
            tool: toolName,
            sessionId: args.sessionId,
            sessionName: args.sessionId ? this.getSessionName(args.sessionId) : undefined,
            success: true,
            timestamp: Date.now()
          });
          
          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // Log tool error
          this.logger.error('tool:error', {
            tool: toolName,
            sessionId: args.sessionId,
            sessionName: args.sessionId ? this.getSessionName(args.sessionId) : undefined,
            error: errorMessage,
            timestamp: Date.now()
          });
          
          if (error instanceof McpError) throw error;
          throw new McpError(McpErrorCode.InternalError, `Failed to execute tool ${toolName}: ${errorMessage}`);
        }
      }
    );
  }

  private async handleListDebugSessions(): Promise<ServerResult> {
    try {
      const sessionsInfo: DebugSessionInfo[] = this.sessionManager.getAllSessions();
      const sessionData = sessionsInfo.map((session: DebugSessionInfo) => {
        const mappedSession: Record<string, unknown> = { 
            id: session.id, 
            name: session.name, 
            language: session.language as DebugLanguage, 
            state: session.state, 
            createdAt: session.createdAt.toISOString(),
        };
        if (session.updatedAt) { 
            mappedSession.updatedAt = session.updatedAt.toISOString();
        }
        return mappedSession;
      });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, sessions: sessionData, count: sessionData.length }) }] };
    } catch (error) {
      this.logger.error('Failed to list debug sessions', { error });
      throw new McpError(McpErrorCode.InternalError, `Failed to list debug sessions: ${(error as Error).message}`);
    }
  }

  private async handlePause(args: { sessionId: string }): Promise<ServerResult> {
    try {
      this.logger.info(`Pause requested for session: ${args.sessionId}`);
      throw new McpError(McpErrorCode.InternalError, "Pause execution not yet implemented with proxy.");
    } catch (error) {
      this.logger.error('Failed to pause execution', { error });
      if (error instanceof McpError) throw error;
      throw new McpError(McpErrorCode.InternalError, `Failed to pause execution: ${(error as Error).message}`);
    }
  }

  private async handleEvaluateExpression(args: { sessionId: string, expression: string }): Promise<ServerResult> {
    try {
      this.logger.info(`Evaluate requested for session: ${args.sessionId}, expression: ${args.expression}`);
      throw new McpError(McpErrorCode.InternalError, "Evaluate expression not yet implemented with proxy.");
    } catch (error) {
      this.logger.error('Failed to evaluate expression', { error });
      if (error instanceof McpError) throw error;
      throw new McpError(McpErrorCode.InternalError, `Failed to evaluate expression: ${(error as Error).message}`);
    }
  }

  private async handleGetSourceContext(args: { sessionId: string, file: string, line: number, linesContext?: number }): Promise<ServerResult> {
    const linesContext = args.linesContext !== undefined ? Number(args.linesContext) : 5;
    if (isNaN(linesContext)) {
      throw new McpError(McpErrorCode.InvalidParams, 'linesContext parameter must be a number');
    }
    try {
      throw new McpError(McpErrorCode.InternalError, "Get source context not yet fully implemented with proxy.");
    } catch (error) {
      this.logger.error('Failed to get source context', { error });
      if (error instanceof McpError) throw error;
      throw new McpError(McpErrorCode.InternalError, `Failed to get source context: ${(error as Error).message}`);
    }
  }

  async start(): Promise<void> {
    this.logger.info('Starting Debug MCP Server (for StdioTransport)');
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      this.logger.info('Server connected to stdio transport');
    } catch (error) {
      this.logger.error('Failed to start server with StdioTransport', { error });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping Debug MCP Server');
    try {
      await this.sessionManager.closeAllSessions();
      await this.server.close();
      this.logger.info('Server stopped');
    } catch (error) {
      this.logger.error('Error stopping server', { error });
      throw error;
    }
  }
}
