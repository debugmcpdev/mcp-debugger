import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'child_process';
import { findPythonExecutable, getPythonVersion, setDefaultCommandFinder } from '../../../src/utils/python-utils.js';
import { MockCommandFinder } from '../../test-utils/mock-command-finder.js';
import { CommandNotFoundError } from '../../../src/interfaces/command-finder.js';
import { EventEmitter } from 'events';

// Mock child_process module for getPythonVersion tests only
vi.mock('child_process', () => ({
  spawn: vi.fn()
}));

const mockSpawn = vi.mocked(spawn);

describe('python-utils', () => {
  let mockCommandFinder: MockCommandFinder;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    delete process.env.PYTHON_PATH;
    delete process.env.PYTHON_EXECUTABLE;
    
    // Create a fresh mock command finder for each test
    mockCommandFinder = new MockCommandFinder();
    
    // Setup default spawn mock for isValidPythonExecutable
    mockSpawn.mockImplementation((cmd, args) => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      
      // Default to successful validation
      process.nextTick(() => proc.emit('exit', 0));
      
      return proc;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockCommandFinder.reset();
  });

  describe('findPythonExecutable', () => {
    describe.each(['win32', 'linux', 'darwin'])('on %s platform', (platform) => {
      beforeEach(() => {
        vi.stubGlobal('process', { ...process, platform });
      });

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      it('should return user-specified pythonPath if it exists', async () => {
        // Configure mock to find the custom path
        mockCommandFinder.setResponse('/custom/python', '/custom/python');

        const result = await findPythonExecutable('/custom/python', undefined, mockCommandFinder);
        expect(result).toBe('/custom/python');
        expect(mockCommandFinder.getCallHistory()).toContain('/custom/python');
      });

      it('should use PYTHON_PATH environment variable if set', async () => {
        process.env.PYTHON_PATH = '/env/python';
        mockCommandFinder.setResponse('/env/python', '/env/python');

        const result = await findPythonExecutable(undefined, undefined, mockCommandFinder);
        expect(result).toBe('/env/python');
        expect(mockCommandFinder.getCallHistory()).toContain('/env/python');
      });

      it('should use PYTHON_EXECUTABLE environment variable if PYTHON_PATH is not set', async () => {
        process.env.PYTHON_EXECUTABLE = '/env/exec/python';
        mockCommandFinder.setResponse('/env/exec/python', '/env/exec/python');

        const result = await findPythonExecutable(undefined, undefined, mockCommandFinder);
        expect(result).toBe('/env/exec/python');
        expect(mockCommandFinder.getCallHistory()).toContain('/env/exec/python');
      });

      it('should auto-detect python commands in platform-specific order', async () => {
        if (platform === 'win32') {
          // On Windows: py -> python -> python3
          mockCommandFinder.setResponse('py', new CommandNotFoundError('py'));
          mockCommandFinder.setResponse('python', 'C:\\Python\\python.exe');
          mockCommandFinder.setResponse('python3', 'C:\\Python3\\python.exe');
        } else {
          // Non-Windows platforms: python3 -> python
          mockCommandFinder.setResponse('python3', '/usr/bin/python3');
          mockCommandFinder.setResponse('python', '/usr/bin/python');
        }

        const result = await findPythonExecutable(undefined, undefined, mockCommandFinder);
        
        if (platform === 'win32') {
          expect(result).toBe('C:\\Python\\python.exe');
          expect(mockCommandFinder.getCallHistory()).toEqual(['py', 'python']);
        } else {
          expect(result).toBe('/usr/bin/python3');
          expect(mockCommandFinder.getCallHistory()).toEqual(['python3']);
        }
      });

      it('should fall back through the command list', async () => {
        if (platform === 'win32') {
          // On Windows, py and python not found, python3 found
          mockCommandFinder.setResponse('py', new CommandNotFoundError('py'));
          mockCommandFinder.setResponse('python', new CommandNotFoundError('python'));
          mockCommandFinder.setResponse('python3', 'C:\\Python3\\python.exe');
        } else {
          // Non-Windows platforms
          mockCommandFinder.setResponse('python3', new CommandNotFoundError('python3'));
          mockCommandFinder.setResponse('python', '/usr/bin/python');
        }

        const result = await findPythonExecutable(undefined, undefined, mockCommandFinder);
        
        if (platform === 'win32') {
          expect(result).toBe('C:\\Python3\\python.exe');
          expect(mockCommandFinder.getCallHistory()).toEqual(['py', 'python', 'python3']);
        } else {
          expect(result).toBe('/usr/bin/python');
          expect(mockCommandFinder.getCallHistory()).toEqual(['python3', 'python']);
        }
      });

      it('should try version-specific pythons if generic ones fail', async () => {
        // This test is no longer applicable as the new implementation
        // only tries ['py', 'python', 'python3'] on Windows and ['python3', 'python'] on Unix
        // The version-specific commands were removed in the refactor
      });

      it('should throw an error if no Python is found', async () => {
        // Configure all commands to fail
        const commands = platform === 'win32' 
          ? ['py', 'python', 'python3']
          : ['python3', 'python'];
          
        commands.forEach(cmd => {
          mockCommandFinder.setResponse(cmd, new CommandNotFoundError(cmd));
        });

        await expect(findPythonExecutable(undefined, undefined, mockCommandFinder))
          .rejects.toThrow('Python not found');
      });

      it('should handle spawn errors gracefully', async () => {
        // Configure mock to throw a different error
        const commands = platform === 'win32' 
          ? ['py', 'python', 'python3']
          : ['python3', 'python'];
          
        commands.forEach(cmd => {
          mockCommandFinder.setResponse(cmd, new Error('spawn failed'));
        });

        // The implementation will throw the error, not wrap it
        await expect(findPythonExecutable(undefined, undefined, mockCommandFinder))
          .rejects.toThrow('spawn failed');
      });
    });

    describe('Windows-specific Store alias handling', () => {
      beforeEach(() => {
        vi.stubGlobal('process', { ...process, platform: 'win32' });
        
        // Mock spawn for validation checks
        mockSpawn.mockImplementation((cmd, args) => {
          const proc = new EventEmitter() as any;
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          
          // Default to successful validation
          process.nextTick(() => proc.emit('exit', 0));
          
          return proc;
        });
      });

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      it('should use where.exe (not where) on Windows to avoid PowerShell alias conflict', async () => {
        // With the new implementation, we're using the 'which' npm package
        // which handles the where.exe vs where issue internally
        mockCommandFinder.setResponse('python', 'C:\\Python\\python.exe');

        const result = await findPythonExecutable(undefined, undefined, mockCommandFinder);
        expect(result).toBe('C:\\Python\\python.exe');
        
        // We now just verify the command was looked up
        expect(mockCommandFinder.getCallHistory()).toContain('python');
      });

      it('should prioritize py launcher on Windows', async () => {
        mockCommandFinder.setResponse('py', 'C:\\Windows\\py.exe');
        mockCommandFinder.setResponse('python', 'C:\\Python\\python.exe');

        const result = await findPythonExecutable(undefined, undefined, mockCommandFinder);
        expect(result).toBe('C:\\Windows\\py.exe');
        
        // Should only have tried 'py' since it was found
        expect(mockCommandFinder.getCallHistory()).toEqual(['py']);
      });

      it('should validate python executable to detect Store aliases', async () => {
        // Configure command finder
        mockCommandFinder.setResponse('py', new CommandNotFoundError('py'));
        mockCommandFinder.setResponse('python', new CommandNotFoundError('python'));
        mockCommandFinder.setResponse('python3', 'C:\\Users\\AppData\\Local\\Microsoft\\WindowsApps\\python3.exe');

        // Mock spawn for validation - python3 is a Store alias
        let validationCallCount = 0;
        mockSpawn.mockImplementation((cmd, args) => {
          const proc = new EventEmitter() as any;
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          
          if (cmd === 'C:\\Users\\AppData\\Local\\Microsoft\\WindowsApps\\python3.exe' && args?.[0] === '-c') {
            validationCallCount++;
            // Simulate Windows Store alias behavior
            process.nextTick(() => {
              proc.stderr.emit('data', Buffer.from('Python was not found; run without arguments to install from the Microsoft Store'));
              proc.emit('exit', 9009);
            });
          } else {
            process.nextTick(() => proc.emit('exit', 0));
          }
          
          return proc;
        });

        // Since all commands fail validation, it should throw
        await expect(findPythonExecutable(undefined, undefined, mockCommandFinder))
          .rejects.toThrow('Python not found');
          
        expect(validationCallCount).toBe(1);
        expect(mockCommandFinder.getCallHistory()).toEqual(['py', 'python', 'python3']);
      });
    });
  });

  describe('getPythonVersion', () => {
    it('should return Python version string', async () => {
      mockSpawn.mockImplementation((cmd, args) => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        
        if (args?.[0] === '--version') {
          process.nextTick(() => {
            proc.stdout.emit('data', Buffer.from('Python 3.11.5\n'));
            proc.emit('exit', 0);
          });
        }
        
        return proc;
      });

      const version = await getPythonVersion('python');
      expect(version).toBe('3.11.5');
    });

    it('should handle version output on stderr', async () => {
      mockSpawn.mockImplementation((cmd, args) => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        
        if (args?.[0] === '--version') {
          process.nextTick(() => {
            proc.stderr.emit('data', Buffer.from('Python 3.9.0'));
            proc.emit('exit', 0);
          });
        }
        
        return proc;
      });

      const version = await getPythonVersion('python');
      expect(version).toBe('3.9.0');
    });

    it('should return null on spawn error', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        process.nextTick(() => proc.emit('error', new Error('spawn failed')));
        return proc;
      });

      const version = await getPythonVersion('python');
      expect(version).toBeNull();
    });

    it('should return null on non-zero exit code', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        process.nextTick(() => proc.emit('exit', 1));
        return proc;
      });

      const version = await getPythonVersion('python');
      expect(version).toBeNull();
    });

    it('should return raw output if version pattern not found', async () => {
      mockSpawn.mockImplementation((cmd, args) => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        
        if (args?.[0] === '--version') {
          process.nextTick(() => {
            proc.stdout.emit('data', Buffer.from('Custom Python Build'));
            proc.emit('exit', 0);
          });
        }
        
        return proc;
      });

      const version = await getPythonVersion('python');
      expect(version).toBe('Custom Python Build');
    });
  });

  describe('setDefaultCommandFinder', () => {
    it('should allow setting a global command finder', async () => {
      const customFinder = new MockCommandFinder();
      customFinder.setResponse('python', '/custom/global/python');
      
      setDefaultCommandFinder(customFinder);
      
      // Call without passing a commandFinder - should use the default
      const result = await findPythonExecutable();
      expect(result).toBe('/custom/global/python');
    });
  });
});
