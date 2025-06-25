import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { DebugMcpServer, DebugMcpServerOptions } from '../../../src/server.js';
import { PathTranslator } from '../../../src/utils/path-translator.js';
import type { ILogger, IFileSystem, IEnvironment } from '../../../src/interfaces/external-dependencies.js';

// Mock dependencies
vi.mock('../../../src/container/dependencies.js', () => ({
  createProductionDependencies: vi.fn(() => ({
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    },
    fileSystem: {
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn()
    },
    environment: {
      get: vi.fn(),
      getCurrentWorkingDirectory: vi.fn()
    },
    processLauncher: {
      spawn: vi.fn()
    },
    networkManager: {
      findAvailablePort: vi.fn()
    },
    processManager: {
      isPortInUse: vi.fn()
    },
    commandFinder: {
      which: vi.fn()
    }
  }))
}));

vi.mock('../../../src/session/session-manager.js', () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    createSession: vi.fn(),
    closeSession: vi.fn(),
    closeAllSessions: vi.fn(),
    getAllSessions: vi.fn().mockReturnValue([]),
    getSession: vi.fn(),
    startDebugging: vi.fn(),
    setBreakpoint: vi.fn(),
    getVariables: vi.fn(),
    getStackTrace: vi.fn(),
    getScopes: vi.fn(),
    continue: vi.fn(),
    stepOver: vi.fn(),
    stepInto: vi.fn(),
    stepOut: vi.fn()
  }))
}));

// Import the schema we need to check against
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Helper function to extract tools from server
async function getToolsFromServer(server: DebugMcpServer): Promise<Array<{
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, { type?: string; description?: string; [key: string]: unknown }>;
    required?: string[];
  };
}>> {
  // The server has a private registerTools method that sets up handlers
  // We need to capture what it registers
  let capturedHandler: unknown = null;
  
  // Spy on setRequestHandler
  const originalSetRequestHandler = server.server.setRequestHandler.bind(server.server);
  server.server.setRequestHandler = vi.fn().mockImplementation(
    (schema: unknown, handler: unknown) => {
      // Check if this is the ListToolsRequestSchema
      if (schema === ListToolsRequestSchema) {
        capturedHandler = handler;
      }
      return originalSetRequestHandler(schema, handler);
    }
  );
  
  // Re-register tools to capture them
  (server as unknown as { registerTools(): void }).registerTools();
  
  // Check if we captured the handler
  if (!capturedHandler) {
    throw new Error('tools/list handler not found');
  }
  
  // Call the handler to get tools
  const listToolsHandler = capturedHandler as (request: unknown) => Promise<unknown>;
  const result = await listToolsHandler({ jsonrpc: '2.0', method: 'tools/list' }) as { tools: Array<unknown> };
  
  // Restore original
  server.server.setRequestHandler = originalSetRequestHandler;
  
  return result.tools as Array<{
    name: string;
    description: string;
    inputSchema: {
      type: string;
      properties: Record<string, { type?: string; description?: string; [key: string]: unknown }>;
      required?: string[];
    };
  }>;
}

describe('Dynamic Tool Documentation', () => {
  let server: DebugMcpServer;
  let mockEnvironment: IEnvironment;
  let mockFileSystem: IFileSystem;
  let mockLogger: ILogger;

  describe('Host Mode', () => {
    const testCwd = process.platform === 'win32' ? 'C:\\Users\\test\\project' : '/home/test/project';

    beforeEach(() => {
      mockEnvironment = {
        get: vi.fn((key: string) => key === 'MCP_CONTAINER' ? undefined : undefined) as (key: string) => string | undefined,
        getCurrentWorkingDirectory: vi.fn().mockReturnValue(testCwd),
        getAll: vi.fn().mockReturnValue({})
      } as unknown as IEnvironment;

      mockFileSystem = {
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn()
      } as unknown as IFileSystem;

      mockLogger = {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
      } as unknown as ILogger;

      const pathTranslator = new PathTranslator(mockFileSystem, mockLogger, mockEnvironment);
      const options: DebugMcpServerOptions = {
        pathTranslator
      };

      server = new DebugMcpServer(options);
    });

    it('should include CWD in set_breakpoint file description', async () => {
      const tools = await getToolsFromServer(server);
      
      const setBreakpointTool = tools.find(t => t.name === 'set_breakpoint');
      expect(setBreakpointTool).toBeDefined();
      
      const fileDescription = setBreakpointTool!.inputSchema.properties.file.description;
      expect(fileDescription).toBeDefined();
      expect(fileDescription).toContain(`server's working directory: ${testCwd}`);
      expect(fileDescription).toContain('Examples:');
      expect(fileDescription).toContain('src/main.py');
      expect(fileDescription).toContain(testCwd);
    });

    it('should include CWD in start_debugging scriptPath description', async () => {
      const tools = await getToolsFromServer(server);
      
      const startDebuggingTool = tools.find(t => t.name === 'start_debugging');
      expect(startDebuggingTool).toBeDefined();
      
      const scriptPathDescription = startDebuggingTool!.inputSchema.properties.scriptPath.description;
      expect(scriptPathDescription).toBeDefined();
      expect(scriptPathDescription).toContain(`server's working directory: ${testCwd}`);
      expect(scriptPathDescription).toContain('Examples:');
      expect(scriptPathDescription).toContain('src/main.py');
    });

    it('should include CWD in get_source_context file description', async () => {
      const tools = await getToolsFromServer(server);
      
      const getSourceContextTool = tools.find(t => t.name === 'get_source_context');
      expect(getSourceContextTool).toBeDefined();
      
      const fileDescription = getSourceContextTool!.inputSchema.properties.file.description;
      expect(fileDescription).toBeDefined();
      expect(fileDescription).toContain(`server's working directory: ${testCwd}`);
    });

    it('should handle long CWD paths without breaking formatting', async () => {
      const longCwd = process.platform === 'win32' 
        ? 'C:\\Very\\Long\\Path\\That\\Goes\\On\\And\\On\\And\\On\\project'
        : '/very/long/path/that/goes/on/and/on/and/on/project';
      
      (mockEnvironment.getCurrentWorkingDirectory as Mock).mockReturnValue(longCwd);
      
      const pathTranslator = new PathTranslator(mockFileSystem, mockLogger, mockEnvironment);
      server = new DebugMcpServer({ pathTranslator });
      
      const tools = await getToolsFromServer(server);
      
      const setBreakpointTool = tools.find(t => t.name === 'set_breakpoint');
      const fileDescription = setBreakpointTool!.inputSchema.properties.file.description;
      
      expect(fileDescription).toContain(longCwd);
      expect(fileDescription).toBeTypeOf('string');
    });

    it('should handle special characters in CWD', async () => {
      const specialCwd = process.platform === 'win32' 
        ? 'C:\\Users\\test\\my project (2024)'
        : '/home/test/my project (2024)';
      
      (mockEnvironment.getCurrentWorkingDirectory as Mock).mockReturnValue(specialCwd);
      
      const pathTranslator = new PathTranslator(mockFileSystem, mockLogger, mockEnvironment);
      server = new DebugMcpServer({ pathTranslator });
      
      const tools = await getToolsFromServer(server);
      
      const setBreakpointTool = tools.find(t => t.name === 'set_breakpoint');
      const fileDescription = setBreakpointTool!.inputSchema.properties.file.description;
      
      expect(fileDescription).toContain(specialCwd);
    });
  });

  describe('Container Mode', () => {
    beforeEach(() => {
      mockEnvironment = {
        get: vi.fn((key: string) => key === 'MCP_CONTAINER' ? 'true' : undefined) as (key: string) => string | undefined,
        getCurrentWorkingDirectory: vi.fn().mockReturnValue('/workspace'),
        getAll: vi.fn().mockReturnValue({ 'MCP_CONTAINER': 'true' })
      } as unknown as IEnvironment;

      mockFileSystem = {
        existsSync: vi.fn().mockReturnValue(true)
      } as unknown as IFileSystem;

      mockLogger = {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
      } as unknown as ILogger;

      const pathTranslator = new PathTranslator(mockFileSystem, mockLogger, mockEnvironment);
      const options: DebugMcpServerOptions = {
        pathTranslator
      };

      server = new DebugMcpServer(options);
    });

    it('should mention /workspace in set_breakpoint file description', async () => {
      const tools = await getToolsFromServer(server);
      
      const setBreakpointTool = tools.find(t => t.name === 'set_breakpoint');
      expect(setBreakpointTool).toBeDefined();
      
      const fileDescription = setBreakpointTool!.inputSchema.properties.file.description;
      expect(fileDescription).toContain('relative to /workspace mount point');
      expect(fileDescription).not.toContain('absolute');
      expect(fileDescription).toContain("Example: 'src/main.py'");
    });

    it('should mention /workspace in start_debugging scriptPath description', async () => {
      const tools = await getToolsFromServer(server);
      
      const startDebuggingTool = tools.find(t => t.name === 'start_debugging');
      expect(startDebuggingTool).toBeDefined();
      
      const scriptPathDescription = startDebuggingTool!.inputSchema.properties.scriptPath.description;
      expect(scriptPathDescription).toBeDefined();
      expect(scriptPathDescription).toContain('relative to /workspace mount point');
      expect(scriptPathDescription).not.toContain('absolute');
    });

    it('should mention /workspace in get_source_context file description', async () => {
      const tools = await getToolsFromServer(server);
      
      const getSourceContextTool = tools.find(t => t.name === 'get_source_context');
      expect(getSourceContextTool).toBeDefined();
      
      const fileDescription = getSourceContextTool!.inputSchema.properties.file.description;
      expect(fileDescription).toBeDefined();
      expect(fileDescription).toContain('relative to /workspace mount point');
    });

    it('should not include absolute path examples in container mode', async () => {
      const tools = await getToolsFromServer(server);
      
      const toolsWithPaths = ['set_breakpoint', 'start_debugging', 'get_source_context'];
      
      toolsWithPaths.forEach(toolName => {
        const tool = tools.find(t => t.name === toolName);
        const pathProperties = ['file', 'scriptPath'];
        
        pathProperties.forEach(prop => {
          if (tool?.inputSchema.properties[prop]?.description) {
            const description = tool.inputSchema.properties[prop].description;
            expect(description).not.toMatch(/[A-Z]:\\/); // No Windows absolute paths
            expect(description).not.toMatch(/^\/[^w]/); // No Unix absolute paths except /workspace
          }
        });
      });
    });
  });

  describe('Consistency', () => {
    it('should use consistent terminology across all path descriptions', async () => {
      // Test in host mode
      mockEnvironment = {
        get: vi.fn((key: string) => key === 'MCP_CONTAINER' ? undefined : undefined) as (key: string) => string | undefined,
        getCurrentWorkingDirectory: vi.fn().mockReturnValue('/test/project'),
        getAll: vi.fn().mockReturnValue({})
      } as unknown as IEnvironment;

      mockFileSystem = {
        existsSync: vi.fn().mockReturnValue(true)
      } as unknown as IFileSystem;

      mockLogger = {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
      } as unknown as ILogger;

      const pathTranslator = new PathTranslator(mockFileSystem, mockLogger, mockEnvironment);
      server = new DebugMcpServer({ pathTranslator });

      const tools = await getToolsFromServer(server);

      // Check that set_breakpoint and get_source_context use "source file"
      const setBreakpointTool = tools.find(t => t.name === 'set_breakpoint');
      expect(setBreakpointTool!.inputSchema.properties.file.description).toContain('source file');

      const getSourceContextTool = tools.find(t => t.name === 'get_source_context');
      expect(getSourceContextTool!.inputSchema.properties.file.description).toContain('source file');

      // Check that start_debugging uses "script"
      const startDebuggingTool = tools.find(t => t.name === 'start_debugging');
      expect(startDebuggingTool!.inputSchema.properties.scriptPath.description).toContain('script');
    });
  });

  describe('MCP Response Serialization', () => {
    it('should properly serialize dynamic descriptions in the MCP response', async () => {
      mockEnvironment = {
        get: vi.fn((key: string) => key === 'MCP_CONTAINER' ? undefined : undefined) as (key: string) => string | undefined,
        getCurrentWorkingDirectory: vi.fn().mockReturnValue('/test/project'),
        getAll: vi.fn().mockReturnValue({})
      } as unknown as IEnvironment;

      mockFileSystem = {
        existsSync: vi.fn().mockReturnValue(true)
      } as unknown as IFileSystem;

      mockLogger = {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
      } as unknown as ILogger;

      const pathTranslator = new PathTranslator(mockFileSystem, mockLogger, mockEnvironment);
      server = new DebugMcpServer({ pathTranslator });

      const tools = await getToolsFromServer(server);

      // Verify the response structure
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      
      // Check that descriptions are strings and contain expected content
      const toolsWithPaths = tools.filter(t => 
        ['set_breakpoint', 'start_debugging', 'get_source_context'].includes(t.name)
      );

      toolsWithPaths.forEach(tool => {
        if (tool.name === 'set_breakpoint') {
          expect(typeof tool.inputSchema.properties.file.description).toBe('string');
          expect(tool.inputSchema.properties.file.description?.length).toBeGreaterThan(0);
        } else if (tool.name === 'start_debugging') {
          expect(typeof tool.inputSchema.properties.scriptPath.description).toBe('string');
          expect(tool.inputSchema.properties.scriptPath.description?.length).toBeGreaterThan(0);
        } else if (tool.name === 'get_source_context') {
          expect(typeof tool.inputSchema.properties.file.description).toBe('string');
          expect(tool.inputSchema.properties.file.description?.length).toBeGreaterThan(0);
        }
      });
    });
  });
});
