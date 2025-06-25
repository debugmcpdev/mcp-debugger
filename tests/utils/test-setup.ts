/**
 * Test Setup Utilities
 * 
 * This module provides helper functions for creating test instances
 * with mock dependencies. Follow this pattern:
 * 
 * 1. Use createTest* functions to get instances with mocks
 * 2. Override specific dependencies as needed
 * 3. Access mocks via the returned deps object
 * 
 * @example
 * const { sessionManager, deps } = createTestSessionManager({
 *   fileSystem: mockFileSystemWithSpecialBehavior
 * });
 */
import { vi } from 'vitest';
import { SessionManager, SessionManagerConfig, SessionManagerDependencies } from '../../src/session/session-manager.js';
import { SessionStore } from '../../src/session/session-store.js';
import { createTestDependencies, createMockDependencies } from './test-dependencies.js';
import { MockProxyManagerFactory } from '../../src/factories/proxy-manager-factory.js';
import { MockProxyManager } from '../mocks/mock-proxy-manager.js';
import { MockSessionStoreFactory, MockSessionStore } from '../../src/factories/session-store-factory.js';

/**
 * Creates a test SessionManager with mock dependencies
 * @param overrides - Partial dependencies to override defaults
 * @param config - SessionManager configuration
 * @returns SessionManager instance and its dependencies
 */
export async function createTestSessionManager(
  overrides: Partial<SessionManagerDependencies> = {},
  config: SessionManagerConfig = {}
): Promise<{ 
  sessionManager: SessionManager; 
  deps: SessionManagerDependencies;
  mockProxyManagerFactory: MockProxyManagerFactory;
  mockSessionStoreFactory: MockSessionStoreFactory;
}> {
  const baseDeps = await createTestDependencies();
  
  // Create a mock environment if not provided
  const mockEnvironment = overrides.environment || {
    get: vi.fn((key: string) => process.env[key]),
    getAll: vi.fn(() => ({ ...process.env })),
    getCurrentWorkingDirectory: vi.fn(() => process.cwd())
  };
  
  const deps: SessionManagerDependencies = {
    fileSystem: overrides.fileSystem || baseDeps.fileSystem,
    networkManager: overrides.networkManager || baseDeps.networkManager,
    logger: overrides.logger || baseDeps.logger,
    proxyManagerFactory: overrides.proxyManagerFactory || baseDeps.proxyManagerFactory,
    sessionStoreFactory: overrides.sessionStoreFactory || baseDeps.sessionStoreFactory,
    debugTargetLauncher: overrides.debugTargetLauncher || baseDeps.debugTargetLauncher,
    environment: mockEnvironment
  };
  
  const sessionManager = new SessionManager(config, deps);
  
  return { 
    sessionManager, 
    deps,
    mockProxyManagerFactory: deps.proxyManagerFactory as MockProxyManagerFactory,
    mockSessionStoreFactory: deps.sessionStoreFactory as MockSessionStoreFactory
  };
}

/**
 * Creates a test SessionStore with optional overrides
 * @returns SessionStore instance and its factory
 */
export function createTestSessionStore(): {
  store: SessionStore;
  factory: MockSessionStoreFactory;
} {
  const factory = new MockSessionStoreFactory();
  const store = factory.create();
  
  return { store, factory };
}

/**
 * Creates a preconfigured mock ProxyManager
 * @param config - Configuration for the mock
 * @returns Configured MockProxyManager
 */
export function createMockProxyManager(config: {
  sessionId?: string;
  isRunning?: boolean;
  currentThreadId?: number | null;
} = {}): MockProxyManager {
  const mockProxyManager = new MockProxyManager();
  
  // The MockProxyManager will set these internally when start() is called
  // or when simulateStopped() is called
  if (config.isRunning) {
    // Simulate a started state with minimal config
    mockProxyManager.start({ 
      sessionId: config.sessionId || 'test-session',
      pythonPath: 'python',
      adapterHost: 'localhost',
      adapterPort: 5678,
      logDir: '/tmp/logs',
      scriptPath: 'test.py'
    });
  }
  
  if (config.currentThreadId !== undefined && config.currentThreadId !== null) {
    // Use the simulateStopped method to set the thread ID
    mockProxyManager.simulateStopped(config.currentThreadId, 'entry');
  }
  
  return mockProxyManager;
}

/**
 * Creates a SessionManager with a specific ProxyManager mock
 * Useful for testing ProxyManager interactions
 */
export async function createTestSessionManagerWithProxyManager(
  mockProxyManager: MockProxyManager,
  overrides: Partial<SessionManagerDependencies> = {},
  config: SessionManagerConfig = {}
): Promise<{
  sessionManager: SessionManager;
  deps: SessionManagerDependencies;
  mockProxyManager: MockProxyManager;
}> {
  const mockFactory = new MockProxyManagerFactory();
  
  // Override the factory's create method to return our specific mock
  mockFactory.create = vi.fn().mockReturnValue(mockProxyManager);
  
  // Configure the factory to use our mock proxy manager
  mockFactory.createFn = () => mockProxyManager;
  
  const { sessionManager, deps } = await createTestSessionManager({
    ...overrides,
    proxyManagerFactory: mockFactory
  }, config);
  
  return { sessionManager, deps, mockProxyManager };
}

/**
 * Helper to create a mock FileSystem with common test behaviors
 */
export function createMockFileSystemWithDefaults() {
  const fileSystem = createMockDependencies().fileSystem;
  
  // Set up common default behaviors
  (fileSystem.pathExists as any).mockResolvedValue(true);
  (fileSystem.ensureDir as any).mockResolvedValue(undefined);
  (fileSystem.ensureDirSync as any).mockImplementation(() => {});
  (fileSystem.readFile as any).mockResolvedValue('{}');
  (fileSystem.writeFile as any).mockResolvedValue(undefined);
  
  return fileSystem;
}

/**
 * Helper to create a mock NetworkManager with common test behaviors
 */
export function createMockNetworkManagerWithDefaults() {
  const networkManager = createMockDependencies().networkManager;
  
  // Set up common default behaviors
  let portCounter = 5678;
  (networkManager.findFreePort as any).mockImplementation(() => Promise.resolve(portCounter++));
  
  return networkManager;
}

/**
 * Helper to wait for async events in tests
 */
export async function waitForEvent(
  emitter: { once: Function },
  event: string,
  timeout: number = 1000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);
    
    emitter.once(event, (...args: any[]) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

/**
 * Helper to simulate ProxyManager lifecycle events
 */
export function simulateProxyManagerLifecycle(mockProxyManager: MockProxyManager, options: {
  stopOnEntry?: boolean;
  threadId?: number;
} = {}) {
  const { stopOnEntry = true, threadId = 1 } = options;
  
  // Simulate initialization
  setTimeout(() => {
    mockProxyManager.emit('initialized');
    mockProxyManager.emit('adapter-configured');
    
    if (stopOnEntry) {
      mockProxyManager.simulateStopped(threadId, 'entry');
    }
  }, 10);
}
