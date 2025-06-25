import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock only the logger, not PathTranslator
vi.mock('../../src/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Container Path Translation Integration', () => {
  let server: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let originalPlatform: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalPlatform = process.platform;
    originalEnv = { ...process.env };
    
    // Clear container environment variables before each test
    delete process.env.MCP_CONTAINER;
    
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    // Restore original environment
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  const setPlatform = (platform: string) => {
    Object.defineProperty(process, 'platform', { value: platform });
  };

  const createServer = async () => {
    // Dynamically import DebugMcpServer to ensure it picks up current environment
    vi.resetModules();
    const { DebugMcpServer } = await import('../../src/server.js');
    server = new DebugMcpServer();
    
    // Mock the sessionManager's internal methods that interact with the proxy
    // to prevent actual process spawning and focus on path translation logic
    const mockSessionManager = {
      createSession: vi.fn(async (params) => ({ id: 'test-session-id', ...params })),
      setBreakpoint: vi.fn(async (sessionId, file, line, condition) => ({ id: 'bp-id', file, line, condition, verified: true })),
      startDebugging: vi.fn(async (_sessionId, scriptPath) => ({
        success: true,
        state: 'RUNNING',
        data: {
          message: `Debug started for ${scriptPath}`,
          translatedPath: scriptPath, // Return the path that was received
        },
      })),
      closeSession: vi.fn(async () => true),
      closeAllSessions: vi.fn(async () => {}),
      getSession: vi.fn(() => ({
        id: 'test-session-id',
        proxyManager: {
          getCurrentThreadId: vi.fn(() => 1),
          sendDapRequest: vi.fn(),
          isRunning: vi.fn(() => true),
        },
      })),
    };
    server['sessionManager'] = mockSessionManager;
    server['logger'] = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  };

  describe('Windows Host in Container', () => {
    beforeEach(async () => {
      setPlatform('win32');
      process.env.MCP_CONTAINER = 'true';
      await createServer();
    });

    it('should reject Windows absolute paths in container mode', async () => {
      const filePath = 'C:\\Users\\john\\project\\src\\main.py';
      await expect(
        server.setBreakpoint('test-session-id', filePath, 10)
      ).rejects.toThrow(Error);
      await expect(
        server.setBreakpoint('test-session-id', filePath, 10)
      ).rejects.toHaveProperty(
        'message',
        expect.stringContaining('not supported in container mode')
      );
    });

    it('should translate relative paths to /workspace', async () => {
      const relativePath = 'src\\main.py';
      const expectedTranslatedPath = '/workspace/src/main.py';
      const result = await server.setBreakpoint('test-session-id', relativePath, 10);
      expect(result.file).toBe(expectedTranslatedPath);
      expect(result.line).toBe(10);
      expect(result.verified).toBe(true);
      expect(server['sessionManager'].setBreakpoint).toHaveBeenCalledWith(
        'test-session-id',
        expectedTranslatedPath,
        10,
        undefined
      );
    });
  });

  describe('Linux Host in Container', () => {
    beforeEach(async () => {
      setPlatform('linux');
      process.env.MCP_CONTAINER = 'true';
      await createServer();
    });

    it('should reject Linux absolute paths in container mode', async () => {
      const filePath = '/home/user/project/src/module.py';
      await expect(
        server.setBreakpoint('test-session-id', filePath, 10)
      ).rejects.toThrow(Error);
      await expect(
        server.setBreakpoint('test-session-id', filePath, 10)
      ).rejects.toHaveProperty(
        'message',
        expect.stringContaining('not supported in container mode')
      );
    });

    it('should translate relative paths to /workspace', async () => {
      const relativePath = 'src/module.py';
      const expectedTranslatedPath = '/workspace/src/module.py';
      const result = await server.setBreakpoint('test-session-id', relativePath, 10);
      expect(result.file).toBe(expectedTranslatedPath);
      expect(result.line).toBe(10);
      expect(result.verified).toBe(true);
      expect(server['sessionManager'].setBreakpoint).toHaveBeenCalledWith(
        'test-session-id',
        expectedTranslatedPath,
        10,
        undefined
      );
    });

    it('should handle paths for start_debugging', async () => {
      const scriptPath = 'tests/test_script.py';
      const expectedTranslatedPath = '/workspace/tests/test_script.py';
      const result = await server.startDebugging('test-session-id', scriptPath);
      expect(result.success).toBe(true);
      expect(result.state).toBe('RUNNING');
      expect(result.data.translatedPath).toBe(expectedTranslatedPath);
      expect(server['sessionManager'].startDebugging).toHaveBeenCalledWith(
        'test-session-id',
        expectedTranslatedPath,
        undefined,
        undefined,
        undefined
      );
    });
  });

  describe('Non-Container Environment', () => {
    beforeEach(async () => {
      // Ensure we're not in container mode
      delete process.env.MCP_CONTAINER;
      delete process.env.MCP_HOST_WORKSPACE;
      await createServer();
    });

    it('should pass through paths without translation for set_breakpoint', async () => {
      const filePath = 'C:\\Users\\john\\project\\src\\main.py';
      const result = await server.setBreakpoint('test-session-id', filePath, 10);
      expect(result.file).toBe(filePath);
      expect(result.line).toBe(10);
      expect(result.verified).toBe(true);
      expect(server['sessionManager'].setBreakpoint).toHaveBeenCalledWith(
        'test-session-id',
        filePath,
        10,
        undefined
      );
    });

    it('should pass through paths without translation for start_debugging', async () => {
      const scriptPath = '/home/user/project/scripts/run.py';
      const result = await server.startDebugging('test-session-id', scriptPath);
      expect(result.success).toBe(true);
      expect(result.state).toBe('RUNNING');
      expect(result.data.translatedPath).toBe(scriptPath);
      expect(server['sessionManager'].startDebugging).toHaveBeenCalledWith(
        'test-session-id',
        scriptPath,
        undefined,
        undefined,
        undefined
      );
    });
  });

  describe('Already Container Path', () => {
    beforeEach(async () => {
      setPlatform('linux');
      process.env.MCP_CONTAINER = 'true';
      await createServer();
    });

    it('should not translate if path is already a container path for set_breakpoint', async () => {
      const filePath = '/workspace/src/already_container.py';
      const result = await server.setBreakpoint('test-session-id', filePath, 15);
      expect(result.file).toBe(filePath);
      expect(result.line).toBe(15);
      expect(result.verified).toBe(true);
      expect(server['sessionManager'].setBreakpoint).toHaveBeenCalledWith(
        'test-session-id',
        filePath,
        15,
        undefined
      );
    });

    it('should not translate if path is already a container path for start_debugging', async () => {
      const scriptPath = '/workspace/scripts/already_container_run.py';
      const result = await server.startDebugging('test-session-id', scriptPath);
      expect(result.success).toBe(true);
      expect(result.state).toBe('RUNNING');
      expect(result.data.translatedPath).toBe(scriptPath);
      expect(server['sessionManager'].startDebugging).toHaveBeenCalledWith(
        'test-session-id',
        scriptPath,
        undefined,
        undefined,
        undefined
      );
    });
  });

});
