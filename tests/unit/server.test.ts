/**
 * Comprehensive unit tests for MCP Server
 * Target: 80%+ coverage from current 52.98%
 */
import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  ErrorCode as McpErrorCode, 
  McpError,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { DebugMcpServer } from '../../src/server.js';
import { SessionManager } from '../../src/session/session-manager.js';
import { DebugSessionInfo, DebugLanguage, SessionState, Breakpoint } from '../../src/session/models.js';
import { createProductionDependencies } from '../../src/container/dependencies.js';
import { createMockLogger } from '../utils/test-dependencies.js';
import { MockProxyManager } from '../mocks/mock-proxy-manager.js';

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/server/index.js');
vi.mock('@modelcontextprotocol/sdk/server/stdio.js');
vi.mock('../../src/session/session-manager.js');
vi.mock('../../src/container/dependencies.js');

describe('MCP Server Comprehensive Tests', () => {
  let debugServer: DebugMcpServer;
  let mockServer: any;
  let mockSessionManager: any;
  let mockLogger: any;
  let mockStdioTransport: any;
  let mockDependencies: any;

  beforeEach(() => {
    // Setup mock logger
    mockLogger = createMockLogger();
    
    // Setup mock dependencies
    mockDependencies = {
      logger: mockLogger,
      fileSystem: {
        existsSync: vi.fn().mockReturnValue(true),
        ensureDirSync: vi.fn(),
        ensureDir: vi.fn().mockResolvedValue(undefined),
        pathExists: vi.fn().mockResolvedValue(true),
        readFile: vi.fn().mockResolvedValue('{}'),
        writeFile: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
        mkdir: vi.fn().mockResolvedValue(undefined),
        readdir: vi.fn().mockResolvedValue([]),
        stat: vi.fn().mockResolvedValue({ isFile: () => true }),
        unlink: vi.fn().mockResolvedValue(undefined),
        rmdir: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        copy: vi.fn().mockResolvedValue(undefined),
        outputFile: vi.fn().mockResolvedValue(undefined)
      },
      processManager: vi.fn(),
      networkManager: vi.fn(),
      processLauncher: vi.fn(),
      proxyProcessLauncher: vi.fn(),
      debugTargetLauncher: vi.fn(),
      proxyManagerFactory: vi.fn(),
      sessionStoreFactory: vi.fn(),
      environment: {
        get: vi.fn((key: string) => process.env[key]),
        getAll: vi.fn(() => ({ ...process.env })),
        getCurrentWorkingDirectory: vi.fn(() => process.cwd())
      }
    };
    
    vi.mocked(createProductionDependencies).mockReturnValue(mockDependencies);
    
    // Setup mock server
    mockServer = {
      setRequestHandler: vi.fn(),
      connect: vi.fn(),
      close: vi.fn(),
      onerror: undefined as any
    };
    
    // Mock Server constructor
    vi.mocked(Server).mockImplementation(() => mockServer as any);
    
    // Setup mock StdioTransport
    mockStdioTransport = {};
    vi.mocked(StdioServerTransport).mockImplementation(() => mockStdioTransport as any);
    
    // Setup mock SessionManager
    mockSessionManager = {
      createSession: vi.fn(),
      getAllSessions: vi.fn(),
      getSession: vi.fn(),
      closeSession: vi.fn(),
      closeAllSessions: vi.fn(),
      setBreakpoint: vi.fn(),
      startDebugging: vi.fn(),
      stepOver: vi.fn(),
      stepInto: vi.fn(),
      stepOut: vi.fn(),
      continue: vi.fn(),
      getVariables: vi.fn(),
      getStackTrace: vi.fn(),
      getScopes: vi.fn()
    };
    
    vi.mocked(SessionManager).mockImplementation(() => mockSessionManager as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize server with correct configuration', () => {
      debugServer = new DebugMcpServer({ logLevel: 'debug' });
      
      expect(Server).toHaveBeenCalledWith(
        { name: 'debug-mcp-server', version: '0.1.0' },
        { capabilities: { tools: {} } }
      );
      
      expect(createProductionDependencies).toHaveBeenCalledWith({
        logLevel: 'debug',
        logFile: undefined,
        sessionLogDirBase: undefined
      });
    });

    it('should initialize with log file configuration', () => {
      debugServer = new DebugMcpServer({ 
        logLevel: 'info',
        logFile: '/var/log/debug-mcp.log'
      });
      
      expect(createProductionDependencies).toHaveBeenCalledWith({
        logLevel: 'info',
        logFile: '/var/log/debug-mcp.log',
        sessionLogDirBase: '/var/log/sessions'
      });
    });

    it('should handle dependency creation errors', () => {
      vi.mocked(createProductionDependencies).mockImplementation(() => {
        throw new Error('Failed to create dependencies');
      });
      
      expect(() => new DebugMcpServer()).toThrow('Failed to create dependencies');
    });

    it('should register tool handlers', () => {
      debugServer = new DebugMcpServer();
      
      // Should register ListTools and CallTool handlers
      expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(2);
    });

    it('should set error handler', () => {
      debugServer = new DebugMcpServer();
      
      expect(mockServer.onerror).toBeDefined();
      
      // Test error handler
      const testError = new Error('Test error');
      if (mockServer.onerror) {
        mockServer.onerror(testError);
      }
      
      expect(mockLogger.error).toHaveBeenCalledWith('Server error', { error: testError });
    });
  });

  describe('Tool Handlers', () => {
    let listToolsHandler: any;
    let callToolHandler: any;

    beforeEach(() => {
      debugServer = new DebugMcpServer();
      
      // Get the handlers
      const handlers = mockServer.setRequestHandler.mock.calls;
      listToolsHandler = handlers[0]?.[1]; // First handler is for ListToolsRequestSchema
      callToolHandler = handlers[1]?.[1]; // Second handler is for CallToolRequestSchema
    });

    it('should handle tools/list request', async () => {
      const result = await listToolsHandler({ method: 'tools/list', params: {} });
      
      expect(result.tools).toBeDefined();
      expect(result.tools.length).toBeGreaterThan(0);
      
      // Check that all required tools are present
      const toolNames = result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('create_debug_session');
      expect(toolNames).toContain('list_debug_sessions');
      expect(toolNames).toContain('set_breakpoint');
      expect(toolNames).toContain('start_debugging');
      expect(toolNames).toContain('close_debug_session');
      expect(toolNames).toContain('step_over');
      expect(toolNames).toContain('step_into');
      expect(toolNames).toContain('step_out');
      expect(toolNames).toContain('continue_execution');
      expect(toolNames).toContain('pause_execution');
      expect(toolNames).toContain('get_variables');
      expect(toolNames).toContain('get_stack_trace');
      expect(toolNames).toContain('get_scopes');
      expect(toolNames).toContain('evaluate_expression');
      expect(toolNames).toContain('get_source_context');
    });

    describe('Debugging Session Tools', () => {
      describe('create_debug_session', () => {
        it('should create session with valid config', async () => {
          const mockSessionInfo: DebugSessionInfo = {
            id: 'test-session-123',
            name: 'Test Session',
            language: 'python' as DebugLanguage,
            state: 'created' as SessionState,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          
          mockSessionManager.createSession.mockResolvedValue(mockSessionInfo);
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'create_debug_session',
              arguments: {
                language: 'python',
                name: 'Test Session',
                pythonPath: '/usr/bin/python3'
              }
            }
          });
          
          expect(mockSessionManager.createSession).toHaveBeenCalledWith({
            language: 'python',
            name: 'Test Session',
            pythonPath: '/usr/bin/python3'
          });
          
          const content = JSON.parse(result.content[0].text);
          expect(content.success).toBe(true);
          expect(content.sessionId).toBe('test-session-123');
          expect(content.message).toContain('Created python debug session');
        });

        it('should handle invalid language parameter', async () => {
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'create_debug_session',
              arguments: {
                language: 'java' // Invalid language
              }
            }
          })).rejects.toThrow(McpError);
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'create_debug_session',
              arguments: {
                language: 'java'
              }
            }
          })).rejects.toThrow("language parameter must be 'python'");
        });

        it('should handle SessionManager creation errors', async () => {
          mockSessionManager.createSession.mockRejectedValue(new Error('Session creation failed'));
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'create_debug_session',
              arguments: {
                language: 'python'
              }
            }
          })).rejects.toThrow(/Session creation failed/);
          
          expect(mockLogger.error).toHaveBeenCalledWith(
            'Failed to create debug session',
            expect.objectContaining({ error: 'Session creation failed' })
          );
        });

        it('should generate default session name if not provided', async () => {
          const mockSessionInfo: DebugSessionInfo = {
            id: 'test-session-123',
            name: 'Debug-1234567890',
            language: 'python' as DebugLanguage,
            state: 'created' as SessionState,
            createdAt: new Date()
          };
          
          mockSessionManager.createSession.mockResolvedValue(mockSessionInfo);
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'create_debug_session',
              arguments: {
                language: 'python'
                // name not provided
              }
            }
          });
          
          const createCall = mockSessionManager.createSession.mock.calls[0][0];
          expect(createCall.name).toMatch(/^Debug-\d+$/);
        });
      });

      describe('list_debug_sessions', () => {
        it('should list all sessions successfully', async () => {
          const mockSessions: DebugSessionInfo[] = [
            {
              id: 'session-1',
              name: 'Session 1',
              language: 'python' as DebugLanguage,
              state: 'running' as SessionState,
              createdAt: new Date(),
              updatedAt: new Date()
            },
            {
              id: 'session-2',
              name: 'Session 2',
              language: 'python' as DebugLanguage,
              state: 'stopped' as SessionState,
              createdAt: new Date()
            }
          ];
          
          mockSessionManager.getAllSessions.mockReturnValue(mockSessions);
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'list_debug_sessions',
              arguments: {}
            }
          });
          
          const content = JSON.parse(result.content[0].text);
          expect(content.success).toBe(true);
          expect(content.sessions).toHaveLength(2);
          expect(content.count).toBe(2);
        });

        it('should handle SessionManager errors', async () => {
          mockSessionManager.getAllSessions.mockImplementation(() => {
            throw new Error('Failed to get sessions');
          });
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'list_debug_sessions',
              arguments: {}
            }
          })).rejects.toThrow(/Failed to get sessions/);
        });
      });

      describe('close_debug_session', () => {
        it('should close session successfully', async () => {
          mockSessionManager.closeSession.mockResolvedValue(true);
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'close_debug_session',
              arguments: { sessionId: 'test-session' }
            }
          });
          
          const content = JSON.parse(result.content[0].text);
          expect(content.success).toBe(true);
          expect(content.message).toContain('Closed debug session');
        });

        it('should handle session not found', async () => {
          mockSessionManager.closeSession.mockResolvedValue(false);
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'close_debug_session',
              arguments: { sessionId: 'non-existent' }
            }
          });
          
          const content = JSON.parse(result.content[0].text);
          expect(content.success).toBe(false);
          expect(content.message).toContain('Failed to close debug session');
        });

        it('should handle SessionManager errors', async () => {
          mockSessionManager.closeSession.mockRejectedValue(new Error('Close failed'));
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'close_debug_session',
              arguments: { sessionId: 'test-session' }
            }
          })).rejects.toThrow(/Close failed/);
        });
      });
    });

    describe('Debugging Control Tools', () => {
      describe('set_breakpoint', () => {
        it('should set breakpoint successfully', async () => {
          const mockBreakpoint: Breakpoint = {
            id: 'bp-1',
            file: 'test.py',
            line: 10,
            verified: true
          };
          
          mockSessionManager.setBreakpoint.mockResolvedValue(mockBreakpoint);
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'set_breakpoint',
              arguments: {
                sessionId: 'test-session',
                file: 'test.py',
                line: 10
              }
            }
          });
          
          expect(mockSessionManager.setBreakpoint).toHaveBeenCalledWith(
            'test-session',
            expect.stringContaining('test.py'),
            10,
            undefined
          );
          
          const content = JSON.parse(result.content[0].text);
          expect(content.success).toBe(true);
          expect(content.breakpointId).toBe('bp-1');
          expect(content.message).toContain('Breakpoint set at test.py:10');
        });

        it('should handle conditional breakpoints', async () => {
          const mockBreakpoint: Breakpoint = {
            id: 'bp-2',
            file: 'test.py',
            line: 20,
            condition: 'x > 10',
            verified: true
          };
          
          mockSessionManager.setBreakpoint.mockResolvedValue(mockBreakpoint);
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'set_breakpoint',
              arguments: {
                sessionId: 'test-session',
                file: 'test.py',
                line: 20,
                condition: 'x > 10'
              }
            }
          });
          
          expect(mockSessionManager.setBreakpoint).toHaveBeenCalledWith(
            'test-session',
            expect.stringContaining('test.py'),
            20,
            'x > 10'
          );
        });

        it('should handle SessionManager errors', async () => {
          mockSessionManager.setBreakpoint.mockRejectedValue(new Error('Breakpoint failed'));
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'set_breakpoint',
              arguments: {
                sessionId: 'test-session',
                file: 'test.py',
                line: 10
              }
            }
          })).rejects.toThrow(/Breakpoint failed/);
        });
      });

      describe('start_debugging', () => {
        it('should start debugging successfully', async () => {
          mockSessionManager.startDebugging.mockResolvedValue({
            success: true,
            state: 'running',
            data: { message: 'Debugging started' }
          });
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'start_debugging',
              arguments: {
                sessionId: 'test-session',
                scriptPath: 'test.py',
                args: ['--debug'],
                dapLaunchArgs: {
                  stopOnEntry: true,
                  justMyCode: false
                }
              }
            }
          });
          
          expect(mockSessionManager.startDebugging).toHaveBeenCalledWith(
            'test-session',
            expect.stringContaining('test.py'),
            ['--debug'],
            { stopOnEntry: true, justMyCode: false },
            undefined
          );
          
          const content = JSON.parse(result.content[0].text);
          expect(content.success).toBe(true);
          expect(content.state).toBe('running');
        });

        it('should handle dry run mode', async () => {
          mockSessionManager.startDebugging.mockResolvedValue({
            success: true,
            state: 'stopped',
            data: { dryRun: true, command: 'python test.py' }
          });
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'start_debugging',
              arguments: {
                sessionId: 'test-session',
                scriptPath: 'test.py',
                dryRunSpawn: true
              }
            }
          });
          
          expect(mockSessionManager.startDebugging).toHaveBeenCalledWith(
            'test-session',
            expect.stringContaining('test.py'),
            undefined,
            undefined,
            true
          );
          
          const content = JSON.parse(result.content[0].text);
          expect(content.data.dryRun).toBe(true);
        });

        it('should handle SessionManager errors', async () => {
          mockSessionManager.startDebugging.mockRejectedValue(new Error('Start failed'));
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'start_debugging',
              arguments: {
                sessionId: 'test-session',
                scriptPath: 'test.py'
              }
            }
          })).rejects.toThrow(/Start failed/);
        });
      });

      describe('step operations', () => {
        it.each([
          ['step_over', 'stepOver', 'Stepped over'],
          ['step_into', 'stepInto', 'Stepped into'],
          ['step_out', 'stepOut', 'Stepped out']
        ])('should handle %s successfully', async (toolName, methodName, expectedMessage) => {
          const stepResult = { success: true, state: 'stopped' };
          mockSessionManager[methodName].mockResolvedValue(stepResult);
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: { sessionId: 'test-session' }
            }
          });
          
          expect(mockSessionManager[methodName]).toHaveBeenCalledWith('test-session');
          const content = JSON.parse(result.content[0].text);
          expect(content.success).toBe(true);
          expect(content.message).toBe(expectedMessage);
        });

        it.each([
          ['step_over', 'stepOver'],
          ['step_into', 'stepInto'],
          ['step_out', 'stepOut']
        ])('should handle %s errors', async (toolName, methodName) => {
          mockSessionManager[methodName].mockRejectedValue(new Error('Step failed'));
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: { sessionId: 'test-session' }
            }
          })).rejects.toThrow(/Step failed/);
        });

        it.each([
          ['step_over', 'stepOver'],
          ['step_into', 'stepInto'],
          ['step_out', 'stepOut']
        ])('should handle %s failure responses', async (toolName, methodName) => {
          const stepResult = { success: false, state: 'error', error: 'Not paused' };
          mockSessionManager[methodName].mockResolvedValue(stepResult);
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: { sessionId: 'test-session' }
            }
          })).rejects.toThrow(/Not paused/);
        });
      });

      describe('continue_execution', () => {
        it('should continue execution successfully', async () => {
          mockSessionManager.continue.mockResolvedValue({
            success: true,
            state: 'running'
          });
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'continue_execution',
              arguments: { sessionId: 'test-session' }
            }
          });
          
          const content = JSON.parse(result.content[0].text);
          expect(content.success).toBe(true);
          expect(content.message).toBe('Continued execution');
        });

        it('should handle continue errors', async () => {
          mockSessionManager.continue.mockRejectedValue(new Error('Continue failed'));
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'continue_execution',
              arguments: { sessionId: 'test-session' }
            }
          })).rejects.toThrow(/Continue failed/);
        });
      });
    });

    describe('Variable and Stack Inspection', () => {
      describe('get_variables', () => {
        it('should get variables successfully', async () => {
          const mockVariables = [
            { name: 'x', value: '10', type: 'int', variablesReference: 0, expandable: false },
            { name: 'y', value: '20', type: 'int', variablesReference: 0, expandable: false }
          ];
          
          mockSessionManager.getVariables.mockResolvedValue(mockVariables);
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'get_variables',
              arguments: {
                sessionId: 'test-session',
                scope: 100
              }
            }
          });
          
          expect(mockSessionManager.getVariables).toHaveBeenCalledWith('test-session', 100);
          
          const content = JSON.parse(result.content[0].text);
          expect(content.success).toBe(true);
          expect(content.variables).toHaveLength(2);
          expect(content.count).toBe(2);
          expect(content.variablesReference).toBe(100);
        });

        it('should validate required scope parameter', async () => {
          // Test for proper MCP parameter validation (improved from previous runtime error behavior)
          // The server now validates parameters upfront and returns clear MCP errors
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'get_variables',
              arguments: {
                sessionId: 'test-session'
                // Missing scope parameter
              }
            }
          })).rejects.toSatisfy((error) => {
            expect(error).toBeInstanceOf(McpError);
            expect(error.code).toBe(McpErrorCode.InvalidParams);
            // The server returns a generic "Missing required parameters" message
            // This is proper parameter validation behavior, preventing undefined values
            // from propagating to the session manager
            expect(error.message).toMatch(/missing.*required.*parameter/i);
            return true;
          });
        });

        it('should validate scope parameter type', async () => {
          // When scope is invalid string, it's passed as NaN which causes the same error
          mockSessionManager.getVariables.mockRejectedValue(new Error("Cannot read properties of undefined (reading 'length')"));
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'get_variables',
              arguments: {
                sessionId: 'test-session',
                scope: 'invalid' // Wrong type
              }
            }
          })).rejects.toThrow(/Cannot read properties of undefined/);
        });

        it('should handle SessionManager errors', async () => {
          mockSessionManager.getVariables.mockRejectedValue(new Error('Variables failed'));
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'get_variables',
              arguments: {
                sessionId: 'test-session',
                scope: 100
              }
            }
          })).rejects.toThrow(/Variables failed/);
        });
      });

      describe('get_stack_trace', () => {
        it('should get stack trace successfully', async () => {
          const mockStackFrames = [
            { id: 1, name: 'main', file: 'test.py', line: 10 }
          ];
          
          const mockSession = {
            proxyManager: {
              getCurrentThreadId: vi.fn().mockReturnValue(1)
            }
          };
          
          mockSessionManager.getSession.mockReturnValue(mockSession);
          mockSessionManager.getStackTrace.mockResolvedValue(mockStackFrames);
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'get_stack_trace',
              arguments: { sessionId: 'test-session' }
            }
          });
          
          const content = JSON.parse(result.content[0].text);
          expect(content.success).toBe(true);
          expect(content.stackFrames).toHaveLength(1);
        });

        it('should handle missing session', async () => {
          mockSessionManager.getSession.mockReturnValue(null);
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'get_stack_trace',
              arguments: { sessionId: 'non-existent' }
            }
          })).rejects.toThrow('Cannot get stack trace: no active proxy, thread, or session not found/paused');
        });

        it('should handle missing proxy manager', async () => {
          const mockSession = { proxyManager: null };
          mockSessionManager.getSession.mockReturnValue(mockSession);
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'get_stack_trace',
              arguments: { sessionId: 'test-session' }
            }
          })).rejects.toThrow('Cannot get stack trace: no active proxy, thread, or session not found/paused');
        });

        it('should handle missing thread ID', async () => {
          const mockSession = {
            proxyManager: {
              getCurrentThreadId: vi.fn().mockReturnValue(null)
            }
          };
          
          mockSessionManager.getSession.mockReturnValue(mockSession);
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'get_stack_trace',
              arguments: { sessionId: 'test-session' }
            }
          })).rejects.toThrow('Cannot get stack trace: no active proxy, thread, or session not found/paused');
        });

        it('should handle SessionManager errors', async () => {
          const mockSession = {
            proxyManager: {
              getCurrentThreadId: vi.fn().mockReturnValue(1)
            }
          };
          
          mockSessionManager.getSession.mockReturnValue(mockSession);
          mockSessionManager.getStackTrace.mockRejectedValue(new Error('Stack trace failed'));
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'get_stack_trace',
              arguments: { sessionId: 'test-session' }
            }
          })).rejects.toThrow(/Stack trace failed/);
        });
      });

      describe('get_scopes', () => {
        it('should get scopes successfully', async () => {
          const mockScopes = [
            { name: 'Locals', variablesReference: 100, expensive: false }
          ];
          
          mockSessionManager.getScopes.mockResolvedValue(mockScopes);
          
          const result = await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'get_scopes',
              arguments: {
                sessionId: 'test-session',
                frameId: 1
              }
            }
          });
          
          const content = JSON.parse(result.content[0].text);
          expect(content.success).toBe(true);
          expect(content.scopes).toHaveLength(1);
        });

        it('should handle SessionManager errors', async () => {
          mockSessionManager.getScopes.mockRejectedValue(new Error('Scopes failed'));
          
          await expect(callToolHandler({
            method: 'tools/call',
            params: {
              name: 'get_scopes',
              arguments: {
                sessionId: 'test-session',
                frameId: 1
              }
            }
          })).rejects.toThrow(/Scopes failed/);
        });
      });
    });

    describe('Unimplemented Tools', () => {
      it('should handle pause_execution as not implemented', async () => {
        await expect(callToolHandler({
          method: 'tools/call',
          params: {
            name: 'pause_execution',
            arguments: { sessionId: 'test-session' }
          }
        })).rejects.toThrow(McpError);
        
        try {
          await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'pause_execution',
              arguments: { sessionId: 'test-session' }
            }
          });
        } catch (error) {
          expect(error).toBeInstanceOf(McpError);
          expect((error as McpError).code).toBe(McpErrorCode.InternalError);
          expect((error as McpError).message).toMatch(/not yet implemented/i);
        }
        
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('Pause requested for session: test-session')
        );
      });

      it('should handle evaluate_expression as not implemented', async () => {
        await expect(callToolHandler({
          method: 'tools/call',
          params: {
            name: 'evaluate_expression',
            arguments: {
              sessionId: 'test-session',
              expression: 'x + y'
            }
          }
        })).rejects.toThrow(McpError);
        
        try {
          await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'evaluate_expression',
              arguments: {
                sessionId: 'test-session',
                expression: 'x + y'
              }
            }
          });
        } catch (error) {
          expect(error).toBeInstanceOf(McpError);
          expect((error as McpError).code).toBe(McpErrorCode.InternalError);
          expect((error as McpError).message).toMatch(/not yet implemented/i);
        }
      });

      it('should handle get_source_context as not implemented', async () => {
        await expect(callToolHandler({
          method: 'tools/call',
          params: {
            name: 'get_source_context',
            arguments: {
              sessionId: 'test-session',
              file: 'test.py',
              line: 10,
              linesContext: 5
            }
          }
        })).rejects.toThrow(McpError);
        
        try {
          await callToolHandler({
            method: 'tools/call',
            params: {
              name: 'get_source_context',
              arguments: {
                sessionId: 'test-session',
                file: 'test.py',
                line: 10
              }
            }
          });
        } catch (error) {
          expect(error).toBeInstanceOf(McpError);
          expect((error as McpError).code).toBe(McpErrorCode.InternalError);
          expect((error as McpError).message).toMatch(/not yet fully implemented/i);
        }
      });

      it('should validate linesContext parameter in get_source_context', async () => {
        await expect(callToolHandler({
          method: 'tools/call',
          params: {
            name: 'get_source_context',
            arguments: {
              sessionId: 'test-session',
              file: 'test.py',
              line: 10,
              linesContext: 'invalid' // Not a number
            }
          }
        })).rejects.toThrow('linesContext parameter must be a number');
      });
    });

    it('should handle unknown tool error', async () => {
      await expect(callToolHandler({
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {}
        }
      })).rejects.toThrow('Unknown tool: unknown_tool');
    });

    it('should handle tool execution errors', async () => {
      mockSessionManager.createSession.mockRejectedValue(new Error('Session creation failed'));
      
      await expect(callToolHandler({
        method: 'tools/call',
        params: {
          name: 'create_debug_session',
          arguments: {
            language: 'python'
          }
        }
      })).rejects.toThrow(/Session creation failed/);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create debug session',
        expect.objectContaining({ error: 'Session creation failed' })
      );
    });
  });

  describe('Server Lifecycle', () => {
    it('should start server with stdio transport', async () => {
      debugServer = new DebugMcpServer();
      
      await debugServer.start();
      
      expect(StdioServerTransport).toHaveBeenCalled();
      expect(mockServer.connect).toHaveBeenCalledWith(mockStdioTransport);
      expect(mockLogger.info).toHaveBeenCalledWith('Starting Debug MCP Server (for StdioTransport)');
      expect(mockLogger.info).toHaveBeenCalledWith('Server connected to stdio transport');
    });

    it('should handle server start errors', async () => {
      debugServer = new DebugMcpServer();
      mockServer.connect.mockRejectedValue(new Error('Connection failed'));
      
      await expect(debugServer.start()).rejects.toThrow('Connection failed');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to start server with StdioTransport',
        { error: expect.any(Error) }
      );
    });

    it('should stop server and close all sessions', async () => {
      debugServer = new DebugMcpServer();
      mockSessionManager.closeAllSessions.mockResolvedValue(undefined);
      mockServer.close.mockResolvedValue(undefined);
      
      await debugServer.stop();
      
      expect(mockSessionManager.closeAllSessions).toHaveBeenCalled();
      expect(mockServer.close).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Stopping Debug MCP Server');
      expect(mockLogger.info).toHaveBeenCalledWith('Server stopped');
    });

    it('should handle errors when closing sessions during stop', async () => {
      debugServer = new DebugMcpServer();
      mockSessionManager.closeAllSessions.mockRejectedValue(new Error('Close sessions failed'));
      mockServer.close.mockResolvedValue(undefined);
      
      await expect(debugServer.stop()).rejects.toThrow('Close sessions failed');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error stopping server',
        { error: expect.any(Error) }
      );
    });

    it('should handle errors when closing server during stop', async () => {
      debugServer = new DebugMcpServer();
      mockSessionManager.closeAllSessions.mockResolvedValue(undefined);
      mockServer.close.mockRejectedValue(new Error('Server close failed'));
      
      await expect(debugServer.stop()).rejects.toThrow('Server close failed');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error stopping server',
        { error: expect.any(Error) }
      );
    });
  });

});
