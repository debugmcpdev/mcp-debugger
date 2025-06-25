/**
 * Unit tests for DapProxyWorker
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { ChildProcess } from 'child_process';
import { DapProxyWorker } from '../../../src/proxy/dap-proxy-worker.js';
import {
  DapProxyDependencies,
  ProxyInitPayload,
  DapCommandPayload,
  TerminatePayload,
  ProxyState,
  IDapClient,
  ILogger
} from '../../../src/proxy/dap-proxy-interfaces.js';

describe('DapProxyWorker', () => {
  let worker: DapProxyWorker;
  let mockDependencies: DapProxyDependencies;
  let mockLogger: ILogger;
  let mockDapClient: IDapClient;
  let mockChildProcess: Partial<ChildProcess>;
  let messageSendSpy: Mock;

  beforeEach(() => {
    // Create mock logger
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn()
    };

    // Create mock DAP client
    mockDapClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      sendRequest: vi.fn().mockResolvedValue({ body: {} }),
      disconnect: vi.fn(),
      shutdown: vi.fn().mockImplementation(() => {
        // Mock implementation that mimics the real shutdown behavior
        // In a real implementation, this would reject pending requests
      }),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn()
    };

    // Create mock child process
    mockChildProcess = {
      pid: 12345,
      kill: vi.fn().mockReturnValue(true),
      killed: false,
      on: vi.fn(),
      unref: vi.fn()
    };

    // Create message send spy
    messageSendSpy = vi.fn();

    // Create mock dependencies
    mockDependencies = {
      loggerFactory: vi.fn().mockResolvedValue(mockLogger),
      fileSystem: {
        ensureDir: vi.fn().mockResolvedValue(undefined),
        pathExists: vi.fn().mockResolvedValue(true)
      },
      processSpawner: {
        spawn: vi.fn().mockReturnValue(mockChildProcess)
      },
      dapClientFactory: {
        create: vi.fn().mockReturnValue(mockDapClient)
      },
      messageSender: {
        send: messageSendSpy
      }
    };

    worker = new DapProxyWorker(mockDependencies);
  });

  afterEach(async () => {
    // Ensure worker is properly shut down after each test
    // This prevents any lingering timers or connections
    if (worker.getState() !== ProxyState.TERMINATED) {
      await worker.shutdown();
    }
    
    // Clear all timers to prevent any lingering timeouts
    vi.clearAllTimers();
    
    // Reset all mocks
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should start in UNINITIALIZED state', () => {
      expect(worker.getState()).toBe(ProxyState.UNINITIALIZED);
    });

    it('should handle init command successfully', async () => {
      const initPayload: ProxyInitPayload = {
        cmd: 'init',
        sessionId: 'test-session',
        pythonPath: '/usr/bin/python3',
        adapterHost: 'localhost',
        adapterPort: 5678,
        logDir: '/tmp/logs',
        scriptPath: '/home/user/script.py',
        scriptArgs: ['arg1', 'arg2'],
        stopOnEntry: true,
        justMyCode: false
      };

      await worker.handleCommand(initPayload);

      // Verify logger was created
      expect(mockDependencies.loggerFactory).toHaveBeenCalledWith('test-session', '/tmp/logs');
      
      // Verify process was spawned
      expect(mockDependencies.processSpawner.spawn).toHaveBeenCalledWith(
        '/usr/bin/python3',
        ['-m', 'debugpy.adapter', '--host', 'localhost', '--port', '5678', '--log-dir', '/tmp/logs'],
        expect.any(Object)
      );

      // Verify DAP client was created and connected
      expect(mockDependencies.dapClientFactory.create).toHaveBeenCalledWith('localhost', 5678);
      expect(mockDapClient.connect).toHaveBeenCalled();
    });

    it('should reject init if already initialized', async () => {
      const initPayload: ProxyInitPayload = {
        cmd: 'init',
        sessionId: 'test-session',
        pythonPath: '/usr/bin/python3',
        adapterHost: 'localhost',
        adapterPort: 5678,
        logDir: '/tmp/logs',
        scriptPath: '/home/user/script.py'
      };

      // First init should succeed
      await worker.handleCommand(initPayload);

      // Second init should fail
      await worker.handleCommand(initPayload);

      expect(messageSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('Invalid state for init')
        })
      );
    });

    // Test removed: Path validation is now handled by PathTranslator at the server level
    // The proxy worker only validates that the path exists, not whether it's absolute

    it('should validate script path exists', async () => {
      mockDependencies.fileSystem.pathExists = vi.fn().mockResolvedValue(false);

      const initPayload: ProxyInitPayload = {
        cmd: 'init',
        sessionId: 'test-session',
        pythonPath: '/usr/bin/python3',
        adapterHost: 'localhost',
        adapterPort: 5678,
        logDir: '/tmp/logs',
        scriptPath: '/home/user/nonexistent.py'
      };

      await worker.handleCommand(initPayload);

      expect(messageSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('Script path not found')
        })
      );
    });

    it('should handle dry run mode', async () => {
      const initPayload: ProxyInitPayload = {
        cmd: 'init',
        sessionId: 'test-session',
        pythonPath: '/usr/bin/python3',
        adapterHost: 'localhost',
        adapterPort: 5678,
        logDir: '/tmp/logs',
        scriptPath: '/home/user/script.py',
        dryRunSpawn: true
      };

      await worker.handleCommand(initPayload);

      // Verify the status message was sent
      expect(messageSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status',
          status: 'dry_run_complete',
          command: expect.stringContaining('python3 -m debugpy.adapter')
        })
      );

      // Verify state is TERMINATED
      expect(worker.getState()).toBe(ProxyState.TERMINATED);
    });
  });

  describe('DAP command handling', () => {
    beforeEach(async () => {
      // Initialize worker first
      const initPayload: ProxyInitPayload = {
        cmd: 'init',
        sessionId: 'test-session',
        pythonPath: '/usr/bin/python3',
        adapterHost: 'localhost',
        adapterPort: 5678,
        logDir: '/tmp/logs',
        scriptPath: '/home/user/script.py'
      };

      await worker.handleCommand(initPayload);

      // Simulate initialized event to reach CONNECTED state
      const onInitialized = (mockDapClient.on as Mock).mock.calls
        .find(call => call[0] === 'initialized')?.[1];
      if (onInitialized) {
        await onInitialized();
      }
    });

    it('should forward DAP commands to client', async () => {
      const dapCommand: DapCommandPayload = {
        cmd: 'dap',
        sessionId: 'test-session',
        requestId: 'req-123',
        dapCommand: 'continue',
        dapArgs: { threadId: 1 }
      };

      const mockResponse = { 
        success: true, 
        body: { allThreadsContinued: true } 
      };
      (mockDapClient.sendRequest as Mock).mockResolvedValue(mockResponse);

      await worker.handleCommand(dapCommand);

      expect(mockDapClient.sendRequest).toHaveBeenCalledWith('continue', { threadId: 1 });
      expect(messageSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'dapResponse',
          requestId: 'req-123',
          success: true,
          body: { allThreadsContinued: true }
        })
      );
    });

    it('should handle DAP command errors', async () => {
      const dapCommand: DapCommandPayload = {
        cmd: 'dap',
        sessionId: 'test-session',
        requestId: 'req-456',
        dapCommand: 'evaluate',
        dapArgs: { expression: 'invalid()' }
      };

      (mockDapClient.sendRequest as Mock).mockRejectedValue(new Error('Evaluation failed'));

      await worker.handleCommand(dapCommand);

      expect(messageSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'dapResponse',
          requestId: 'req-456',
          success: false,
          error: 'Evaluation failed'
        })
      );
    });

    it('should reject DAP commands before connection', async () => {
      // Create fresh worker without initialization
      const newWorker = new DapProxyWorker(mockDependencies);

      const dapCommand: DapCommandPayload = {
        cmd: 'dap',
        sessionId: 'test-session',
        requestId: 'req-789',
        dapCommand: 'continue'
      };

      await newWorker.handleCommand(dapCommand);

      expect(messageSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'dapResponse',
          requestId: 'req-789',
          success: false,
          error: 'DAP client not connected'
        })
      );
    });
  });

  describe('terminate handling', () => {
    beforeEach(async () => {
      // Initialize worker first to ensure logger is available
      const initPayload: ProxyInitPayload = {
        cmd: 'init',
        sessionId: 'test-session',
        pythonPath: '/usr/bin/python3',
        adapterHost: 'localhost',
        adapterPort: 5678,
        logDir: '/tmp/logs',
        scriptPath: '/home/user/script.py'
      };
      await worker.handleCommand(initPayload);
    });

    it('should handle terminate command', async () => {
      const terminateCommand: TerminatePayload = {
        cmd: 'terminate',
        sessionId: 'test-session'
      };

      await worker.handleCommand(terminateCommand);

      expect(messageSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status',
          status: 'terminated'
        })
      );
      
      expect(worker.getState()).toBe(ProxyState.TERMINATED);
    });
  });

  describe('event handling', () => {
    let eventHandlers: Record<string, (...args: unknown[]) => void>;

    beforeEach(async () => {
      // Initialize worker
      const initPayload: ProxyInitPayload = {
        cmd: 'init',
        sessionId: 'test-session',
        pythonPath: '/usr/bin/python3',
        adapterHost: 'localhost',
        adapterPort: 5678,
        logDir: '/tmp/logs',
        scriptPath: '/home/user/script.py'
      };

      await worker.handleCommand(initPayload);

      // Capture event handlers
      eventHandlers = {};
      (mockDapClient.on as Mock).mock.calls.forEach(call => {
        eventHandlers[call[0]] = call[1];
      });
    });

    it('should handle stopped event', () => {
      const stoppedBody = {
        reason: 'breakpoint',
        threadId: 1,
        allThreadsStopped: true
      };

      eventHandlers['stopped'](stoppedBody);

      expect(messageSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'dapEvent',
          event: 'stopped',
          body: stoppedBody
        })
      );
    });

    it('should handle output event', () => {
      const outputBody = {
        category: 'stdout',
        output: 'Hello, world!\n'
      };

      eventHandlers['output'](outputBody);

      expect(messageSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'dapEvent',
          event: 'output',
          body: outputBody
        })
      );
    });

    it('should handle terminated event and shutdown', async () => {
      const terminatedBody = { restart: false };

      // The handler is not async, so we can't await it.
      // It triggers shutdown(), which is async. We need to wait for it to complete.
      eventHandlers['terminated'](terminatedBody);

      // Give the async shutdown promise time to resolve
      await new Promise(resolve => setImmediate(resolve));

      expect(messageSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'dapEvent',
          event: 'terminated',
          body: terminatedBody
        })
      );

      // Verify shutdown was called
      expect(mockDapClient.shutdown).toHaveBeenCalledWith('worker shutdown');
      expect(mockDapClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('should clean up resources on shutdown', async () => {
      // Initialize worker with all resources
      const initPayload: ProxyInitPayload = {
        cmd: 'init',
        sessionId: 'test-session',
        pythonPath: '/usr/bin/python3',
        adapterHost: 'localhost',
        adapterPort: 5678,
        logDir: '/tmp/logs',
        scriptPath: '/home/user/script.py'
      };

      await worker.handleCommand(initPayload);

      // Call shutdown
      await worker.shutdown();

      // Verify cleanup
      expect(mockDapClient.sendRequest).toHaveBeenCalledWith('disconnect', { terminateDebuggee: true });
      expect(mockDapClient.disconnect).toHaveBeenCalled();
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(worker.getState()).toBe(ProxyState.TERMINATED);
    });

    it('should handle shutdown when already shutting down', async () => {
      await worker.shutdown();
      const state1 = worker.getState();
      
      await worker.shutdown(); // Second call
      const state2 = worker.getState();

      expect(state1).toBe(ProxyState.TERMINATED);
      expect(state2).toBe(ProxyState.TERMINATED);
    });
  });
});
