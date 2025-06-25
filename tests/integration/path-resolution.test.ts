import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DebugMcpServer } from '../../src/server.js';
import { DebugLanguage } from '../../src/session/models.js';
import path from 'path';
import os from 'os';

describe('Path Resolution Integration Test', () => {
  let server: DebugMcpServer;
  let originalEnv: NodeJS.ProcessEnv;
  let testProjectRoot: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    
    // Set up a test project root
    testProjectRoot = path.join(os.tmpdir(), 'test-debug-project');
    
    // Mock process.cwd to return our test project root
    vi.spyOn(process, 'cwd').mockReturnValue(testProjectRoot);
    
    // Clear MCP environment variables
    delete process.env.MCP_CONTAINER;
    
    // Create server instance
    server = new DebugMcpServer();
  });

  afterEach(async () => {
    await server.stop();
    // Don't try to restore cwd in worker threads - process.chdir() is not supported
    // process.chdir(originalCwd);
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('resolves relative paths from current working directory', async () => {
    // Create a debug session
    const session = await server.createDebugSession({
      language: DebugLanguage.PYTHON,
      name: 'test-session',
      pythonPath: 'python'
    });

    // Mock file existence check
    const mockExistsSync = vi.fn().mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pathTranslator = (server as any).pathTranslator;
    pathTranslator.fileSystem.existsSync = mockExistsSync;

    // Test relative path resolution for set_breakpoint
    const relativePath = 'examples/python/fibonacci.py';
    const expectedAbsolutePath = path.join(testProjectRoot, relativePath);
    
    try {
      await server.setBreakpoint(session.id, relativePath, 5);
      
      // Verify that the path was checked for existence
      expect(mockExistsSync).toHaveBeenCalledWith(expectedAbsolutePath);
    } catch {
      // Even if the actual debugging operation fails (no real Python file),
      // we can verify that path resolution happened correctly
      expect(mockExistsSync).toHaveBeenCalledWith(expectedAbsolutePath);
    }
  });

  it('preserves absolute paths', async () => {
    // Create a debug session
    const session = await server.createDebugSession({
      language: DebugLanguage.PYTHON,
      name: 'test-session',
      pythonPath: 'python'
    });

    // Mock file existence check
    const mockExistsSync = vi.fn().mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pathTranslator = (server as any).pathTranslator;
    pathTranslator.fileSystem.existsSync = mockExistsSync;

    // Test absolute path
    const absolutePath = process.platform === 'win32' 
      ? 'C:\\absolute\\path\\to\\file.py'
      : '/absolute/path/to/file.py';
    
    try {
      await server.setBreakpoint(session.id, absolutePath, 15);
      
      // Verify that existsSync was not called for absolute paths
      expect(mockExistsSync).not.toHaveBeenCalled();
    } catch {
      // Even if the actual debugging operation fails,
      // we verified that absolute paths are not checked
      expect(mockExistsSync).not.toHaveBeenCalled();
    }
  });

  it('provides helpful error for non-existent relative paths', async () => {
    // Create a debug session
    const session = await server.createDebugSession({
      language: DebugLanguage.PYTHON,
      name: 'test-session',
      pythonPath: 'python'
    });

    // Mock file existence check to return false
    const mockExistsSync = vi.fn().mockReturnValue(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pathTranslator = (server as any).pathTranslator;
    pathTranslator.fileSystem.existsSync = mockExistsSync;

    // Test with non-existent relative path
    const relativePath = 'nonexistent/file.py';
    
    await expect(server.setBreakpoint(session.id, relativePath, 20))
      .rejects.toThrow(/Could not find file at resolved path/);
    
    // Verify the error includes helpful information
    await expect(server.setBreakpoint(session.id, relativePath, 20))
      .rejects.toThrow(new RegExp(`Attempted to resolve relative path: ${relativePath}`));
    
    await expect(server.setBreakpoint(session.id, relativePath, 20))
      .rejects.toThrow(new RegExp(`Using workspace root: ${testProjectRoot.replace(/\\/g, '\\\\')}`));
  });
});
