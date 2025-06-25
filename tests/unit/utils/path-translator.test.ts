import { PathTranslator } from '../../../src/utils/path-translator';
import { IFileSystem, ILogger, IEnvironment } from '../../../src/interfaces/external-dependencies';
import path from 'path';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('PathTranslator', () => {
  let mockFileSystem: IFileSystem;
  let mockLogger: ILogger;
  let translator: PathTranslator;

  // Helper to create platform-specific mock environments
  const createWindowsMockEnvironment = (isContainer: boolean, cwd: string = 'C:\\project'): IEnvironment => ({
    get: vi.fn((key: string) => {
      if (key === 'MCP_CONTAINER') return isContainer ? 'true' : undefined;
      return undefined;
    }),
    getAll: vi.fn(() => ({})),
    getCurrentWorkingDirectory: vi.fn(() => cwd)
  });

  const createLinuxMockEnvironment = (isContainer: boolean, cwd: string = '/home/user/project'): IEnvironment => ({
    get: vi.fn((key: string) => {
      if (key === 'MCP_CONTAINER') return isContainer ? 'true' : undefined;
      return undefined;
    }),
    getAll: vi.fn(() => ({})),
    getCurrentWorkingDirectory: vi.fn(() => cwd)
  });

  // Helper to create file system mock
  const createMockFileSystem = (existingFiles: string[]): IFileSystem => ({
    existsSync: vi.fn((filePath: string) => existingFiles.includes(filePath)),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    rmdir: vi.fn(),
    ensureDir: vi.fn(),
    ensureDirSync: vi.fn(),
    pathExists: vi.fn(),
    remove: vi.fn(),
    copy: vi.fn(),
    outputFile: vi.fn()
  });

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn()
    };
  });

  describe('when running on host system', () => {
    describe('on Windows host', () => {
      it('should resolve relative paths from current working directory', () => {
        const cwd = 'C:\\Users\\user\\myproject';
        const mockEnv = createWindowsMockEnvironment(false, cwd);
        const existingFiles = [
          path.resolve(cwd, 'src\\file.py'),
          path.resolve(cwd, 'test.py')
        ];
        mockFileSystem = createMockFileSystem(existingFiles);
        
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        // Test various relative paths
        expect(translator.translatePath('src\\file.py')).toBe(path.resolve(cwd, 'src\\file.py'));
        expect(translator.translatePath('.\\src\\file.py')).toBe(path.resolve(cwd, 'src\\file.py'));
        expect(translator.translatePath('test.py')).toBe(path.resolve(cwd, 'test.py'));
      });

      it('should return absolute paths unchanged', () => {
        const mockEnv = createWindowsMockEnvironment(false);
        mockFileSystem = createMockFileSystem([]);
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        const absolutePath = 'C:\\absolute\\path\\to\\file.py';
        expect(translator.translatePath(absolutePath)).toBe(absolutePath);
        
        // Should not check existence for absolute paths
        expect(mockFileSystem.existsSync).not.toHaveBeenCalled();
      });

      it('should handle forward slashes in relative paths correctly', () => {
        const cwd = 'C:\\project';
        const mockEnv = createWindowsMockEnvironment(false, cwd);
        const expectedPath = path.resolve(cwd, 'src/file.py');
        mockFileSystem = createMockFileSystem([expectedPath]);
        
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        // Windows path.resolve handles forward slashes correctly
        expect(translator.translatePath('./src/file.py')).toBe(expectedPath);
        expect(translator.translatePath('src/file.py')).toBe(expectedPath);
      });

      it('should throw error with helpful message when file not found', () => {
        const cwd = 'C:\\workspace';
        const mockEnv = createWindowsMockEnvironment(false, cwd);
        mockFileSystem = createMockFileSystem([]); // No files exist
        
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        const relativePath = 'missing\\file.py';
        const expectedPath = path.resolve(cwd, relativePath);
        
        expect(() => translator.translatePath(relativePath)).toThrow(
          expect.objectContaining({
            message: expect.stringContaining(expectedPath)
          })
        );
        
        expect(() => translator.translatePath(relativePath)).toThrow(
          expect.objectContaining({
            message: expect.stringContaining(cwd)
          })
        );
      });
    });

    describe('on Linux host', () => {
      it('should resolve relative paths from current working directory', () => {
        const cwd = '/home/user/myproject';
        const mockEnv = createLinuxMockEnvironment(false, cwd);
        const existingFiles = [
          path.resolve(cwd, 'src/file.py'),
          path.resolve(cwd, 'test.py')
        ];
        mockFileSystem = createMockFileSystem(existingFiles);
        
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        // Test various relative paths
        expect(translator.translatePath('src/file.py')).toBe(path.resolve(cwd, 'src/file.py'));
        expect(translator.translatePath('./src/file.py')).toBe(path.resolve(cwd, 'src/file.py'));
        expect(translator.translatePath('test.py')).toBe(path.resolve(cwd, 'test.py'));
      });

      it('should return absolute paths unchanged', () => {
        const mockEnv = createLinuxMockEnvironment(false);
        mockFileSystem = createMockFileSystem([]);
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        const absolutePath = '/absolute/path/to/file.py';
        expect(translator.translatePath(absolutePath)).toBe(absolutePath);
        
        // Should not check existence for absolute paths
        expect(mockFileSystem.existsSync).not.toHaveBeenCalled();
      });

      it('should throw error with helpful message when file not found', () => {
        const cwd = '/home/user/project';
        const mockEnv = createLinuxMockEnvironment(false, cwd);
        mockFileSystem = createMockFileSystem([]); // No files exist
        
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        const relativePath = 'missing/file.py';
        const expectedPath = path.resolve(cwd, relativePath);
        
        expect(() => translator.translatePath(relativePath)).toThrow(
          expect.objectContaining({
            message: expect.stringContaining(expectedPath)
          })
        );
        
        expect(() => translator.translatePath(relativePath)).toThrow(
          expect.objectContaining({
            message: expect.stringContaining(cwd)
          })
        );
      });
    });

    describe('common host behavior', () => {
      it('should handle empty string input', () => {
        const cwd = process.platform === 'win32' ? 'C:\\project' : '/home/user/project';
        const mockEnv = process.platform === 'win32' 
          ? createWindowsMockEnvironment(false, cwd)
          : createLinuxMockEnvironment(false, cwd);
        mockFileSystem = createMockFileSystem([cwd]); // CWD exists
        
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        // Empty string should resolve to CWD
        expect(translator.translatePath('')).toBe(cwd);
      });

      it('should handle just a filename with no path', () => {
        const cwd = process.platform === 'win32' ? 'C:\\workspace' : '/workspace';
        const mockEnv = process.platform === 'win32'
          ? createWindowsMockEnvironment(false, cwd)
          : createLinuxMockEnvironment(false, cwd);
        const filename = 'script.py';
        const expectedPath = path.resolve(cwd, filename);
        mockFileSystem = createMockFileSystem([expectedPath]);
        
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        expect(translator.translatePath(filename)).toBe(expectedPath);
      });
    });
  });

  describe('when running in container (Linux)', () => {
    describe('relative path handling', () => {
      it('should map relative paths to /workspace', () => {
        const mockEnv = createLinuxMockEnvironment(true);
        mockFileSystem = createMockFileSystem([]);
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        // Various relative path formats
        expect(translator.translatePath('src/file.py')).toBe('/workspace/src/file.py');
        expect(translator.translatePath('./src/file.py')).toBe('/workspace/src/file.py');
        expect(translator.translatePath('../file.py')).toBe('/workspace/../file.py');
        expect(translator.translatePath('file.py')).toBe('/workspace/file.py');
      });

      it('should normalize Windows backslashes to forward slashes in container', () => {
        const mockEnv = createLinuxMockEnvironment(true);
        mockFileSystem = createMockFileSystem([]);
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        // Windows-style paths should be normalized
        expect(translator.translatePath('src\\subfolder\\file.py')).toBe('/workspace/src/subfolder/file.py');
        expect(translator.translatePath('.\\src\\file.py')).toBe('/workspace/src/file.py');
        expect(translator.translatePath('folder\\file.py')).toBe('/workspace/folder/file.py');
      });

      it('should handle mixed separators correctly', () => {
        const mockEnv = createLinuxMockEnvironment(true);
        mockFileSystem = createMockFileSystem([]);
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        expect(translator.translatePath('src/subfolder\\file.py')).toBe('/workspace/src/subfolder/file.py');
        expect(translator.translatePath('path\\to/mixed\\file.py')).toBe('/workspace/path/to/mixed/file.py');
      });

      it('should handle empty string by returning /workspace', () => {
        const mockEnv = createLinuxMockEnvironment(true);
        mockFileSystem = createMockFileSystem([]);
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        expect(translator.translatePath('')).toBe('/workspace');
      });
    });

    describe('absolute path rejection', () => {
      it('should reject Windows absolute paths with clear error', () => {
        const mockEnv = createLinuxMockEnvironment(true);
        mockFileSystem = createMockFileSystem([]);
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        const windowsAbsolutePaths = ['C:\\project\\file.py', 'D:\\temp\\data.txt', 'E:\\'];
        
        windowsAbsolutePaths.forEach(absPath => {
          expect(() => translator.translatePath(absPath)).toThrow(
            expect.objectContaining({
              message: expect.stringContaining(absPath) // Contains original path
            })
          );
          
          expect(() => translator.translatePath(absPath)).toThrow(
            expect.objectContaining({
              message: expect.stringContaining('not supported') // Clear statement
            })
          );
          
          expect(() => translator.translatePath(absPath)).toThrow(
            expect.objectContaining({
              message: expect.stringContaining('/workspace') // Reference to workspace
            })
          );
        });
      });

      it('should reject Linux absolute paths with clear error', () => {
        const mockEnv = createLinuxMockEnvironment(true);
        mockFileSystem = createMockFileSystem([]);
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        const linuxAbsolutePaths = ['/home/user/file.py', '/opt/app/data.txt', '/etc/config'];
        
        linuxAbsolutePaths.forEach(absPath => {
          expect(() => translator.translatePath(absPath)).toThrow(
            expect.objectContaining({
              message: expect.stringContaining(absPath) // Contains original path
            })
          );
          
          expect(() => translator.translatePath(absPath)).toThrow(
            expect.objectContaining({
              message: expect.stringContaining('not supported') // Clear statement
            })
          );
          
          expect(() => translator.translatePath(absPath)).toThrow(
            expect.objectContaining({
              message: expect.stringContaining('/workspace') // Reference to workspace
            })
          );
        });
      });
    });

    describe('workspace path handling', () => {
      it('should return paths already starting with /workspace unchanged', () => {
        const mockEnv = createLinuxMockEnvironment(true);
        mockFileSystem = createMockFileSystem([]);
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        const workspacePaths = [
          '/workspace/src/file.py',
          '/workspace/test.py',
          '/workspace'
        ];
        
        workspacePaths.forEach(wsPath => {
          expect(translator.translatePath(wsPath)).toBe(wsPath);
        });
      });

      it('should handle /workspace with additional path segments', () => {
        const mockEnv = createLinuxMockEnvironment(true);
        mockFileSystem = createMockFileSystem([]);
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        expect(translator.translatePath('/workspace/deep/nested/path/file.py')).toBe('/workspace/deep/nested/path/file.py');
      });
    });

    describe('error messages', () => {
      it('should provide context about container mode in error messages', () => {
        const mockEnv = createLinuxMockEnvironment(true);
        mockFileSystem = createMockFileSystem([]);
        translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
        
        // Test Windows absolute path error
        try {
          translator.translatePath('C:\\Users\\test\\file.py');
          expect.fail('Should have thrown error');
        } catch (error) {
          const errorMessage = (error as Error).message;
          expect(errorMessage).toContain('C:\\Users\\test\\file.py');
          expect(errorMessage).toContain('not supported in container mode');
          expect(errorMessage).toContain('/workspace');
          expect(errorMessage).toContain('relative paths');
        }
        
        // Test Linux absolute path error
        try {
          translator.translatePath('/home/user/project/file.py');
          expect.fail('Should have thrown error');
        } catch (error) {
          const errorMessage = (error as Error).message;
          expect(errorMessage).toContain('/home/user/project/file.py');
          expect(errorMessage).toContain('not supported in container mode');
          expect(errorMessage).toContain('/workspace');
          expect(errorMessage).toContain('relative paths');
        }
      });
    });
  });

  describe('edge cases', () => {
    it('should handle paths with multiple dots correctly', () => {
      const mockEnv = createLinuxMockEnvironment(true);
      mockFileSystem = createMockFileSystem([]);
      translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
      
      expect(translator.translatePath('../../file.py')).toBe('/workspace/../../file.py');
      expect(translator.translatePath('./../src/file.py')).toBe('/workspace/../src/file.py');
    });

    it('should handle paths with trailing slashes', () => {
      const mockEnv = createLinuxMockEnvironment(true);
      mockFileSystem = createMockFileSystem([]);
      translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
      
      expect(translator.translatePath('src/')).toBe('/workspace/src/');
      expect(translator.translatePath('src\\')).toBe('/workspace/src/');
    });

    it('should handle UNC paths as absolute paths in container mode', () => {
      const mockEnv = createLinuxMockEnvironment(true);
      mockFileSystem = createMockFileSystem([]);
      translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
      
      expect(() => translator.translatePath('\\\\server\\share\\file.py')).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('not supported in container mode')
        })
      );
    });
  });

  describe('logging behavior', () => {
    it('should log initialization details', () => {
      const mockEnv = createLinuxMockEnvironment(true);
      mockFileSystem = createMockFileSystem([]);
      
      new PathTranslator(mockFileSystem, mockLogger, mockEnv);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('PathTranslator initialized')
      );
    });

    it('should log path translation in debug mode', () => {
      const mockEnv = createLinuxMockEnvironment(true);
      mockFileSystem = createMockFileSystem([]);
      translator = new PathTranslator(mockFileSystem, mockLogger, mockEnv);
      
      translator.translatePath('src/file.py');
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Translating path')
      );
    });
  });
});
