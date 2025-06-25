/**
 * Central dependency container for the application
 * Manages all dependencies and their wiring for production use
 */
import { ContainerConfig } from './types.js';
import { createLogger } from '../utils/logger.js';
import { 
  IFileSystem, 
  IProcessManager, 
  INetworkManager, 
  ILogger,
  IProxyManagerFactory,
  IEnvironment
} from '../interfaces/external-dependencies.js';
import { 
  IProcessLauncher, 
  IDebugTargetLauncher, 
  IProxyProcessLauncher 
} from '../interfaces/process-interfaces.js';
import { 
  FileSystemImpl, 
  ProcessManagerImpl, 
  NetworkManagerImpl,
  ProcessLauncherImpl,
  ProxyProcessLauncherImpl,
  DebugTargetLauncherImpl 
} from '../implementations/index.js';
import { ProcessEnvironment } from '../implementations/environment-impl.js';
import { ISessionStoreFactory } from '../factories/session-store-factory.js';
import { SessionStoreFactory } from '../factories/session-store-factory.js';
import { ProxyManagerFactory } from '../factories/proxy-manager-factory.js';

/**
 * Complete set of application dependencies
 */
export interface Dependencies {
  // Core implementations
  fileSystem: IFileSystem;
  processManager: IProcessManager;
  networkManager: INetworkManager;
  logger: ILogger;
  environment: IEnvironment;
  
  // Process launchers
  processLauncher: IProcessLauncher;
  proxyProcessLauncher: IProxyProcessLauncher;
  debugTargetLauncher: IDebugTargetLauncher;
  
  // Factories
  proxyManagerFactory: IProxyManagerFactory;
  sessionStoreFactory: ISessionStoreFactory;
}

/**
 * Creates production dependencies with real implementations
 * @param config - Configuration for services like logging
 * @returns Complete dependency container for production use
 */
export function createProductionDependencies(config: ContainerConfig = {}): Dependencies {
  // Create logger with configuration
  const logger = createLogger('debug-mcp', {
    level: config.logLevel,
    file: config.logFile,
    ...config.loggerOptions
  });
  
  // Create base implementations
  const environment = new ProcessEnvironment();
  const fileSystem = new FileSystemImpl();
  const processManager = new ProcessManagerImpl();
  const networkManager = new NetworkManagerImpl();
  
  // Create process launchers
  const processLauncher = new ProcessLauncherImpl(processManager);
  const proxyProcessLauncher = new ProxyProcessLauncherImpl(processLauncher);
  const debugTargetLauncher = new DebugTargetLauncherImpl(processLauncher, networkManager);
  
  // Create factories
  const proxyManagerFactory = new ProxyManagerFactory(
    proxyProcessLauncher,
    fileSystem,
    logger
  );
  
  const sessionStoreFactory = new SessionStoreFactory();
  
  return {
    fileSystem,
    processManager,
    networkManager,
    logger,
    environment,
    processLauncher,
    proxyProcessLauncher,
    debugTargetLauncher,
    proxyManagerFactory,
    sessionStoreFactory
  };
}
