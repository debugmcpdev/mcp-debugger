/**
 * Test-only dependencies - DO NOT import this file in production code!
 * This file imports Vitest and other test frameworks.
 */
import { vi } from 'vitest';
import { ContainerConfig } from '../../src/container/types.js';
import { 
  IFileSystem, 
  IProcessManager, 
  INetworkManager, 
  ILogger,
  IProxyManagerFactory
} from '../../src/interfaces/external-dependencies.js';
import { 
  IProcessLauncher, 
  IDebugTargetLauncher, 
  IProxyProcessLauncher 
} from '../../src/interfaces/process-interfaces.js';
import { ISessionStoreFactory } from '../../src/factories/session-store-factory.js';
import { MockSessionStoreFactory } from '../../src/factories/session-store-factory.js';
import { MockProxyManagerFactory } from '../../src/factories/proxy-manager-factory.js';
import { MockProxyManager } from '../mocks/mock-proxy-manager.js';
import { createLogger } from '../../src/utils/logger.js';
import { DebugMcpServer, DebugMcpServerOptions } from '../../src/server.js';

/**
 * Creates a DebugMcpServer configured for testing
 * @param options Additional options to override defaults
 * @returns A new DebugMcpServer instance configured for tests
 */
export function createTestServer(options: DebugMcpServerOptions = {}): DebugMcpServer {
  // Always use 'error' log level for tests unless explicitly overridden
  const testOptions: DebugMcpServerOptions = {
    logLevel: 'error',
    ...options
  };
  
  return new DebugMcpServer(testOptions);
}

/**
 * Complete set of application dependencies
 */
export interface Dependencies {
  // Core implementations
  fileSystem: IFileSystem;
  processManager: IProcessManager;
  networkManager: INetworkManager;
  logger: ILogger;
  
  // Process launchers
  processLauncher: IProcessLauncher;
  proxyProcessLauncher: IProxyProcessLauncher;
  debugTargetLauncher: IDebugTargetLauncher;
  
  // Factories
  proxyManagerFactory: IProxyManagerFactory;
  sessionStoreFactory: ISessionStoreFactory;
}

/**
 * Creates test dependencies with fake/mock implementations
 * @returns Complete dependency container for testing
 */
export async function createTestDependencies(): Promise<Dependencies> {
  const logger = createMockLogger();
  const fileSystem = createMockFileSystem();
  const processManager = createMockProcessManager();
  const networkManager = createMockNetworkManager();
  
  // Note: These will be imported from tests/implementations/test/ after we move them
  const { FakeProcessLauncher, FakeProxyProcessLauncher, FakeDebugTargetLauncher } = 
    await import('../implementations/test/fake-process-launcher.ts');
  
  const processLauncher = new FakeProcessLauncher();
  const proxyProcessLauncher = new FakeProxyProcessLauncher();
  const debugTargetLauncher = new FakeDebugTargetLauncher();
  
  const proxyManagerFactory = new MockProxyManagerFactory();
  proxyManagerFactory.createFn = () => new MockProxyManager();
  const sessionStoreFactory = new MockSessionStoreFactory();
  
  return {
    fileSystem,
    processManager,
    networkManager,
    logger,
    processLauncher,
    proxyProcessLauncher,
    debugTargetLauncher,
    proxyManagerFactory,
    sessionStoreFactory
  };
}

/**
 * Creates a complete set of mock dependencies for testing
 * All methods are vi.fn() mocks with proper typing
 * @returns Dependencies with all methods mocked
 */
export function createMockDependencies(): Dependencies {
  const fileSystem = createMockFileSystem();
  const processManager = createMockProcessManager();
  const networkManager = createMockNetworkManager();
  const logger = createMockLogger();
  
  const processLauncher = createMockProcessLauncher();
  const proxyProcessLauncher = createMockProxyProcessLauncher();
  const debugTargetLauncher = createMockDebugTargetLauncher();
  
  const proxyManagerFactory = new MockProxyManagerFactory();
  proxyManagerFactory.createFn = () => new MockProxyManager();
  const sessionStoreFactory = new MockSessionStoreFactory();
  
  return {
    fileSystem,
    processManager,
    networkManager,
    logger,
    processLauncher,
    proxyProcessLauncher,
    debugTargetLauncher,
    proxyManagerFactory,
    sessionStoreFactory
  };
}

// Mock creation helpers

export function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  };
}

export function createMockFileSystem(): IFileSystem {
  return {
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
  };
}

export function createMockProcessManager(): IProcessManager {
  return {
    spawn: vi.fn(),
    exec: vi.fn()
  };
}

export function createMockNetworkManager(): INetworkManager {
  return {
    createServer: vi.fn(),
    findFreePort: vi.fn().mockResolvedValue(5678)
  };
}

export function createMockProcessLauncher(): IProcessLauncher {
  return {
    launch: vi.fn()
  };
}

export function createMockProxyProcessLauncher(): IProxyProcessLauncher {
  return {
    launchProxy: vi.fn()
  };
}

export function createMockDebugTargetLauncher(): IDebugTargetLauncher {
  return {
    launchPythonDebugTarget: vi.fn()
  };
}
