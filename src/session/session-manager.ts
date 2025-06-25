/**
 * Session manager for debug sessions, using ProxyManager for process management.
 * 
 * This class manages the lifecycle of debug sessions and delegates all child process
 * and DAP communication to ProxyManager instances. Each session has its own ProxyManager
 * that handles the debug proxy process.
 */
import { v4 as uuidv4 } from 'uuid';
import { 
  Breakpoint, SessionState, Variable, StackFrame, DebugLanguage, DebugSessionInfo 
} from './models.js'; 
import { SessionStore, ManagedSession } from './session-store.js';
import { DebugProtocol } from '@vscode/debugprotocol'; 
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { 
  IFileSystem, 
  INetworkManager, 
  ILogger,
  IProxyManagerFactory,
  IEnvironment
} from '../interfaces/external-dependencies.js';
import { ISessionStoreFactory } from '../factories/session-store-factory.js';
import { IProxyManager, ProxyConfig } from '../proxy/proxy-manager.js';
import { IDebugTargetLauncher } from '../interfaces/process-interfaces.js';
import { ErrorMessages } from '../utils/error-messages.js';
import { findPythonExecutable } from '../utils/python-utils.js';
import { PathTranslator } from '../utils/path-translator.js';

// Custom launch arguments interface extending DebugProtocol.LaunchRequestArguments
interface CustomLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
  stopOnEntry?: boolean;
  justMyCode?: boolean;
  // Add other common custom arguments here if needed, e.g., console, cwd, env
}

// Define DebugResult interface (previously imported from provider.js)
interface DebugResult {
  success: boolean;
  state: SessionState;
  error?: string;
  data?: unknown;
}

// ManagedSession is now imported from session-store.ts

/**
 * Complete dependencies for SessionManager
 */
export interface SessionManagerDependencies {
  fileSystem: IFileSystem;
  networkManager: INetworkManager;
  logger: ILogger;
  proxyManagerFactory: IProxyManagerFactory;
  sessionStoreFactory: ISessionStoreFactory;
  debugTargetLauncher: IDebugTargetLauncher;
  environment: IEnvironment;
}

/**
 * Configuration for SessionManager
 */
export interface SessionManagerConfig {
  logDirBase?: string;
  defaultDapLaunchArgs?: Partial<CustomLaunchRequestArguments>;
  dryRunTimeoutMs?: number;
}

export class SessionManager {
  private sessionStore: SessionStore;
  private logDirBase: string;
  private logger: ILogger;
  private fileSystem: IFileSystem;
  private networkManager: INetworkManager;
  private proxyManagerFactory: IProxyManagerFactory;
  private sessionStoreFactory: ISessionStoreFactory;
  private debugTargetLauncher: IDebugTargetLauncher;
  private pathTranslator: PathTranslator; // Add PathTranslator instance

  private defaultDapLaunchArgs: Partial<CustomLaunchRequestArguments>;
  private dryRunTimeoutMs: number;
  
  // WeakMap to store event handlers for cleanup
  private sessionEventHandlers = new WeakMap<ManagedSession, Map<string, (...args: unknown[]) => void>>();

  /**
   * Constructor with full dependency injection
   */
  constructor(
    config: SessionManagerConfig,
    dependencies: SessionManagerDependencies
  ) {
    this.logger = dependencies.logger;
    this.fileSystem = dependencies.fileSystem;
    this.networkManager = dependencies.networkManager;
    this.proxyManagerFactory = dependencies.proxyManagerFactory;
    this.sessionStoreFactory = dependencies.sessionStoreFactory;
    this.debugTargetLauncher = dependencies.debugTargetLauncher;
    this.pathTranslator = new PathTranslator(this.fileSystem, this.logger, dependencies.environment);
    
    this.sessionStore = this.sessionStoreFactory.create();
    this.logDirBase = config.logDirBase || path.join(os.tmpdir(), 'debug-mcp-server', 'sessions');
    this.defaultDapLaunchArgs = config.defaultDapLaunchArgs || {
      stopOnEntry: true,
      justMyCode: true
    };
    this.dryRunTimeoutMs = config.dryRunTimeoutMs || 10000;
    
    this.fileSystem.ensureDirSync(this.logDirBase);
    this.logger.info(`[SessionManager] Initialized. Session logs will be stored in: ${this.logDirBase}`);
  }

  async createSession(params: { language: DebugLanguage; name?: string; pythonPath?: string; }): Promise<DebugSessionInfo> {
    const sessionInfo = this.sessionStore.createSession(params);
    this.logger.info(`[SessionManager] Created new session: ${sessionInfo.name} (ID: ${sessionInfo.id}), state: ${sessionInfo.state}`);
    return sessionInfo;
  }

  private async startProxyManager(
    session: ManagedSession, 
    scriptPath: string, 
    scriptArgs?: string[], 
    dapLaunchArgs?: Partial<CustomLaunchRequestArguments>, 
    dryRunSpawn?: boolean
  ): Promise<void> {
    const sessionId = session.id;

    // Create session log directory
    const sessionLogDir = path.join(this.logDirBase, sessionId, `run-${Date.now()}`);
    this.logger.info(`[SessionManager] Ensuring session log directory: ${sessionLogDir}`);
    try {
      await this.fileSystem.ensureDir(sessionLogDir);
      const dirExists = await this.fileSystem.pathExists(sessionLogDir);
      if (!dirExists) {
        throw new Error(`Log directory ${sessionLogDir} could not be created`);
      }
    } catch (err: unknown) { 
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[SessionManager] Failed to create log directory:`, err);
      throw new Error(`Failed to create session log directory: ${message}`);
    }

    // Get free port for adapter
    const adapterPort = await this.findFreePort();

    // Resolve paths
    const projectRoot = path.resolve(fileURLToPath(import.meta.url), '../../../'); // Path to the MCP debugger server's root
    
    const initialBreakpoints = Array.from(session.breakpoints.values()).map(bp => {
        // Breakpoint file path is already translated by server.ts before reaching here
        return {
            file: bp.file, // Use the already translated path
            line: bp.line, 
            condition: bp.condition
        };
    });
    
    // scriptPath is already translated by server.ts before reaching here
    const translatedScriptPath = scriptPath; 
    this.logger.info(`[SessionManager] Using translated script path: ${translatedScriptPath}`);

    // Resolve Python path with intelligent detection
    let resolvedPythonPath: string;
    const pythonPathFromSession = session.pythonPath!;
    
    if (path.isAbsolute(pythonPathFromSession)) {
      // Absolute path provided - use as-is
      resolvedPythonPath = pythonPathFromSession;
    } else if (['python', 'python3', 'py'].includes(pythonPathFromSession.toLowerCase())) {
      // Common Python commands - use auto-detection without preferredPath
      try {
        resolvedPythonPath = await findPythonExecutable(undefined, this.logger);
        this.logger.info(`[SessionManager] Auto-detected Python executable: ${resolvedPythonPath}`);
      } catch (error) {
        this.logger.error(`[SessionManager] Failed to find Python executable:`, error);
        throw error;
      }
    } else {
      // Relative path - resolve from project root (MCP server's root)
      resolvedPythonPath = path.resolve(projectRoot, pythonPathFromSession);
    }

    // In container mode, Python executables are system binaries and should NOT be translated
    // Only user script paths need translation, not the Python interpreter itself
    if (this.pathTranslator.isContainerMode()) {
      this.logger.info(`[SessionManager] Container mode: Using Python path as-is (system binary): ${resolvedPythonPath}`);
    }
    
    this.logger.info(`[SessionManager] Using Python path: ${resolvedPythonPath}`);

    // Merge launch args
    const effectiveLaunchArgs = {
      ...this.defaultDapLaunchArgs,
      ...(dapLaunchArgs || {}),
    };

    // Create ProxyConfig
    const proxyConfig: ProxyConfig = {
      sessionId,
      pythonPath: resolvedPythonPath,
      adapterHost: '127.0.0.1',
      adapterPort,
      logDir: sessionLogDir,
      scriptPath: translatedScriptPath, // Use the already translated script path
      scriptArgs,
      stopOnEntry: effectiveLaunchArgs.stopOnEntry,
      justMyCode: effectiveLaunchArgs.justMyCode,
      initialBreakpoints,
      dryRunSpawn: dryRunSpawn === true
    };

    // Create and start ProxyManager
    const proxyManager = this.proxyManagerFactory.create();
    session.proxyManager = proxyManager;

    // Set up event handlers
    this.setupProxyEventHandlers(session, proxyManager, effectiveLaunchArgs);

    // Start the proxy
    await proxyManager.start(proxyConfig);
  }
  
  private setupProxyEventHandlers(
    session: ManagedSession, 
    proxyManager: IProxyManager,
    effectiveLaunchArgs: Partial<CustomLaunchRequestArguments>
  ): void {
    const sessionId = session.id;
    const handlers = new Map<string, (...args: any[]) => void>(); // eslint-disable-line @typescript-eslint/no-explicit-any -- Event handlers require flexible argument signatures to support various event types

    // Named function for stopped event
    const handleStopped = (threadId: number, reason: string) => {
      this.logger.debug(`[SessionManager] 'stopped' event handler called for session ${sessionId}`);
      this.logger.info(`[ProxyManager ${sessionId}] Stopped event: thread=${threadId}, reason=${reason}`);
      
      // Log debug state change with structured logging
      // Note: We don't have location info at this point, but that could be added later if needed
      this.logger.info('debug:state', {
        event: 'paused',
        sessionId: sessionId,
        sessionName: session.name,
        reason: reason,
        threadId: threadId,
        timestamp: Date.now()
      });
      
      // Handle auto-continue for stopOnEntry=false
      if (!effectiveLaunchArgs.stopOnEntry && reason === 'entry') {
        this.logger.info(`[ProxyManager ${sessionId}] Auto-continuing (stopOnEntry=false)`);
        this.continue(sessionId).catch(err => {
          this.logger.error(`[ProxyManager ${sessionId}] Error auto-continuing:`, err);
        });
      } else {
        this._updateSessionState(session, SessionState.PAUSED);
      }
    };
    proxyManager.on('stopped', handleStopped);
    handlers.set('stopped', handleStopped);

    // Named function for continued event
    const handleContinued = () => {
      this.logger.debug(`[SessionManager] 'continued' event handler called for session ${sessionId}`);
      this.logger.info(`[ProxyManager ${sessionId}] Continued event`);
      
      // Log debug state change with structured logging
      this.logger.info('debug:state', {
        event: 'running',
        sessionId: sessionId,
        sessionName: session.name,
        timestamp: Date.now()
      });
      
      this._updateSessionState(session, SessionState.RUNNING);
    };
    proxyManager.on('continued', handleContinued);
    handlers.set('continued', handleContinued);

    // Named function for terminated event
    const handleTerminated = () => {
      this.logger.debug(`[SessionManager] 'terminated' event handler called for session ${sessionId}`);
      this.logger.info(`[ProxyManager ${sessionId}] Terminated event`);
      
      // Log debug state change with structured logging
      this.logger.info('debug:state', {
        event: 'stopped',
        sessionId: sessionId,
        sessionName: session.name,
        timestamp: Date.now()
      });
      
      this._updateSessionState(session, SessionState.STOPPED);
      
      // Clean up listeners since proxy is gone
      this.cleanupProxyEventHandlers(session, proxyManager);
      session.proxyManager = undefined;
    };
    proxyManager.on('terminated', handleTerminated);
    handlers.set('terminated', handleTerminated);

    // Named function for exited event
    const handleExited = () => {
      this.logger.debug(`[SessionManager] 'exited' event handler called for session ${sessionId}`);
      this.logger.info(`[ProxyManager ${sessionId}] Exited event`);
      this._updateSessionState(session, SessionState.STOPPED);
      session.proxyManager = undefined;
    };
    proxyManager.on('exited', handleExited);
    handlers.set('exited', handleExited);

    // Named function for adapter configured event
    const handleAdapterConfigured = () => {
      this.logger.debug(`[SessionManager] 'adapter-configured' event handler called for session ${sessionId}`);
      this.logger.info(`[ProxyManager ${sessionId}] Adapter configured`);
      if (!effectiveLaunchArgs.stopOnEntry) {
        this._updateSessionState(session, SessionState.RUNNING);
      }
    };
    proxyManager.on('adapter-configured', handleAdapterConfigured);
    handlers.set('adapter-configured', handleAdapterConfigured);

    // Named function for dry run complete event
    const handleDryRunComplete = (command: string, script: string) => {
      this.logger.debug(`[SessionManager] 'dry-run-complete' event handler called for session ${sessionId}`);
      this.logger.info(`[ProxyManager ${sessionId}] Dry run complete: ${command} ${script}`);
      this._updateSessionState(session, SessionState.STOPPED);
      // Don't clear proxyManager yet if we have a dry run handler waiting
      const sessionWithSetup = session as ManagedSession & { _dryRunHandlerSetup?: boolean };
      if (!sessionWithSetup._dryRunHandlerSetup) {
        session.proxyManager = undefined;
      }
    };
    proxyManager.on('dry-run-complete', handleDryRunComplete);
    handlers.set('dry-run-complete', handleDryRunComplete);

    // Named function for error event
    const handleError = (error: Error) => {
      this.logger.debug(`[SessionManager] 'error' event handler called for session ${sessionId}`);
      this.logger.error(`[ProxyManager ${sessionId}] Error:`, error);
      this._updateSessionState(session, SessionState.ERROR);
      session.proxyManager = undefined;
    };
    proxyManager.on('error', handleError);
    handlers.set('error', handleError);

    // Named function for exit event
    const handleExit = (code: number | null, signal?: string) => {
      this.logger.debug(`[SessionManager] 'exit' event handler called for session ${sessionId}`);
      this.logger.info(`[ProxyManager ${sessionId}] Exit: code=${code}, signal=${signal}`);
      if (session.state !== SessionState.STOPPED && session.state !== SessionState.ERROR) {
        this._updateSessionState(session, SessionState.ERROR);
      }
      
      // Clean up listeners since proxy is gone
      this.cleanupProxyEventHandlers(session, proxyManager);
      session.proxyManager = undefined;
    };
    proxyManager.on('exit', handleExit);
    handlers.set('exit', handleExit);

    // Store handlers in WeakMap
    this.sessionEventHandlers.set(session, handlers);
    this.logger.debug(`[SessionManager] Attached ${handlers.size} event handlers for session ${sessionId}`);
  }

  
  private cleanupProxyEventHandlers(session: ManagedSession, proxyManager: IProxyManager): void {
    // Safety check to prevent double cleanup
    if (!this.sessionEventHandlers.has(session)) {
      this.logger.debug(`[SessionManager] Cleanup already performed for session ${session.id}`);
      return;
    }

    const handlers = this.sessionEventHandlers.get(session);
    if (!handlers) {
      this.logger.debug(`[SessionManager] No handlers found for session ${session.id}`);
      return;
    }
    
    let removedCount = 0;
    let failedCount = 0;
    
    handlers.forEach((handler, eventName) => {
      try {
        this.logger.debug(`[SessionManager] Removing ${eventName} listener for session ${session.id}`);
        proxyManager.removeListener(eventName, handler);
        removedCount++;
      } catch (error) {
        this.logger.error(`[SessionManager] Failed to remove ${eventName} listener for session ${session.id}:`, error);
        failedCount++;
        // Continue cleanup despite errors
      }
    });
    
    this.logger.info(`[SessionManager] Cleanup complete for session ${session.id}: ${removedCount} removed, ${failedCount} failed`);
    this.sessionEventHandlers.delete(session);
  }

  private async findFreePort(): Promise<number> {
    return this.networkManager.findFreePort();
  }

  private _getSessionById(sessionId: string): ManagedSession {
    return this.sessionStore.getOrThrow(sessionId);
  }

  private _updateSessionState(session: ManagedSession, newState: SessionState): void {
    if (session.state === newState) return;
    this.logger.info(`[SM _updateSessionState ${session.id}] State change: ${session.state} -> ${newState}`);
    this.sessionStore.updateState(session.id, newState);
  }

  /**
   * Helper method to wait for dry run completion with timeout
   */
  private async waitForDryRunCompletion(
    session: ManagedSession, 
    timeoutMs: number
  ): Promise<boolean> {
    let handler: (() => void) | null = null;
    let timeoutId: NodeJS.Timeout | null = null;
    
    try {
      return await Promise.race([
        new Promise<boolean>((resolve) => {
          handler = () => {
            this.logger.info(`[SessionManager] Dry run completion event received for session ${session.id}`);
            resolve(true);
          };
          this.logger.info(`[SessionManager] Setting up dry-run-complete listener for session ${session.id}`);
          session.proxyManager?.once('dry-run-complete', handler);
        }),
        new Promise<boolean>((resolve) => {
          timeoutId = setTimeout(() => {
            this.logger.warn(`[SessionManager] Dry run timeout after ${timeoutMs}ms for session ${session.id}`);
            resolve(false);
          }, timeoutMs);
        })
      ]);
    } finally {
      // Clean up immediately
      if (handler && session.proxyManager) {
        this.logger.info(`[SessionManager] Removing dry-run-complete listener for session ${session.id}`);
        session.proxyManager.removeListener('dry-run-complete', handler);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async startDebugging(
    sessionId: string, 
    scriptPath: string, 
    scriptArgs?: string[], 
    dapLaunchArgs?: Partial<CustomLaunchRequestArguments>, 
    dryRunSpawn?: boolean
  ): Promise<DebugResult> {
    const session = this._getSessionById(sessionId);
    this.logger.info(`Attempting to start debugging for session ${sessionId}, script: ${scriptPath}, dryRunSpawn: ${dryRunSpawn}, dapLaunchArgs:`, dapLaunchArgs);

    if (session.proxyManager) {
      this.logger.warn(`[SessionManager] Session ${sessionId} already has an active proxy. Terminating before starting new.`);
      await this.closeSession(sessionId); 
    }
    
    this._updateSessionState(session, SessionState.INITIALIZING); 
    try {
      // For dry run, start the proxy and wait for completion
      if (dryRunSpawn) {
        // Mark that we're setting up a dry run handler
        const sessionWithSetup = session as ManagedSession & { _dryRunHandlerSetup?: boolean };
        sessionWithSetup._dryRunHandlerSetup = true;
        
        // Start the proxy manager
        await this.startProxyManager(session, scriptPath, scriptArgs, dapLaunchArgs, dryRunSpawn);
        this.logger.info(`[SessionManager] ProxyManager started for session ${sessionId}`);
        
        // Check if already completed before waiting
        const refreshedSession = this._getSessionById(sessionId);
        this.logger.info(`[SessionManager] Checking state after start: ${refreshedSession.state}`);
        if (refreshedSession.state === SessionState.STOPPED) {
          this.logger.info(`[SessionManager] Dry run already completed for session ${sessionId}`);
          delete sessionWithSetup._dryRunHandlerSetup;
          return { 
            success: true, 
            state: SessionState.STOPPED,
            data: { dryRun: true, message: "Dry run spawn command logged by proxy." } 
          };
        }
        
        // Wait for completion with timeout
        this.logger.info(`[SessionManager] Waiting for dry run completion with timeout ${this.dryRunTimeoutMs}ms`);
        const dryRunCompleted = await this.waitForDryRunCompletion(refreshedSession, this.dryRunTimeoutMs);
        delete sessionWithSetup._dryRunHandlerSetup;
        
        if (dryRunCompleted) {
          this.logger.info(`[SessionManager] Dry run completed for session ${sessionId}, final state: ${refreshedSession.state}`);
          return { 
            success: true, 
            state: SessionState.STOPPED,
            data: { dryRun: true, message: "Dry run spawn command logged by proxy." } 
          };
        } else {
          // Timeout occurred
          const finalSession = this._getSessionById(sessionId);
          this.logger.error(
            `[SessionManager] Dry run timeout for session ${sessionId}. ` +
            `State: ${finalSession.state}, ProxyManager active: ${!!finalSession.proxyManager}`
          );
          return { 
            success: false, 
            error: `Dry run timed out after ${this.dryRunTimeoutMs}ms. Current state: ${finalSession.state}`, 
            state: finalSession.state 
          };
        }
      }
      
      // Normal (non-dry-run) flow
      // Start the proxy manager
      await this.startProxyManager(session, scriptPath, scriptArgs, dapLaunchArgs, dryRunSpawn);
      this.logger.info(`[SessionManager] ProxyManager started for session ${sessionId}`);
      
      // Wait for adapter to be configured or first stop event
      const waitForReady = new Promise<void>((resolve) => {
        let resolved = false;
        
        const handleStopped = () => {
          if (!resolved) {
            resolved = true;
            this.logger.info(`[SessionManager] Session ${sessionId} stopped on entry`);
            resolve();
          }
        };
        
        const handleConfigured = () => {
          if (!resolved && !dapLaunchArgs?.stopOnEntry) {
            resolved = true;
            this.logger.info(`[SessionManager] Session ${sessionId} running (stopOnEntry=false)`);
            resolve();
          }
        };
        
        session.proxyManager?.once('stopped', handleStopped);
        session.proxyManager?.once('adapter-configured', handleConfigured);
        
        // Timeout after 30 seconds
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            session.proxyManager?.removeListener('stopped', handleStopped);
            session.proxyManager?.removeListener('adapter-configured', handleConfigured);
            this.logger.warn(ErrorMessages.adapterReadyTimeout(30));
            resolve();
          }
        }, 30000);
      });
      
      await waitForReady;
      
      this.logger.info(`[SessionManager] Debugging started for session ${sessionId}. State: ${session.state}`);
      
      return { 
        success: true, 
        state: session.state, 
        data: { 
          message: `Debugging started for ${scriptPath}. Current state: ${session.state}`,
          reason: session.state === SessionState.PAUSED ? (dapLaunchArgs?.stopOnEntry ? 'entry' : 'breakpoint') : undefined,
          stopOnEntrySuccessful: dapLaunchArgs?.stopOnEntry && session.state === SessionState.PAUSED,
        } 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : 'No stack available';
      
      this.logger.error(`[SessionManager] Error during startDebugging for session ${sessionId}: ${errorMessage}. Stack: ${errorStack}`);
      
      this._updateSessionState(session, SessionState.ERROR);
      
      if (session.proxyManager) {
        await session.proxyManager.stop();
        session.proxyManager = undefined;
      }
      
      return { success: false, error: errorMessage, state: session.state };
    }
  }
  
  async setBreakpoint(sessionId: string, file: string, line: number, condition?: string): Promise<Breakpoint> {
    const session = this._getSessionById(sessionId);
    const bpId = uuidv4();

    // The file path is already translated by server.ts before reaching here
    // No need for projectRoot resolution here.
    const translatedFilePath = file; 
    this.logger.info(`[SessionManager setBreakpoint] Using translated file path "${translatedFilePath}" for session ${sessionId}`);

    const newBreakpoint: Breakpoint = { id: bpId, file: translatedFilePath, line, condition, verified: false };

    if (!session.breakpoints) session.breakpoints = new Map();
    session.breakpoints.set(bpId, newBreakpoint);
    this.logger.info(`[SessionManager] Breakpoint ${bpId} queued for ${file}:${line} in session ${sessionId}.`);

    if (session.proxyManager && session.proxyManager.isRunning() && (session.state === SessionState.RUNNING || session.state === SessionState.PAUSED)) {
      try {
          this.logger.info(`[SessionManager] Active proxy for session ${sessionId}, sending breakpoint ${bpId}.`);
          const response = await session.proxyManager.sendDapRequest<DebugProtocol.SetBreakpointsResponse>('setBreakpoints', { 
              source: { path: newBreakpoint.file }, 
              breakpoints: [{ line: newBreakpoint.line, condition: newBreakpoint.condition }]
          });
          if (response && response.body && response.body.breakpoints && response.body.breakpoints.length > 0) {
              const bpInfo = response.body.breakpoints[0]; 
              newBreakpoint.verified = bpInfo.verified;
              newBreakpoint.line = bpInfo.line || newBreakpoint.line; 
              this.logger.info(`[SessionManager] Breakpoint ${bpId} sent and response received. Verified: ${newBreakpoint.verified}`);
              
              // Log breakpoint verification with structured logging
              if (newBreakpoint.verified) {
                this.logger.info('debug:breakpoint', {
                  event: 'verified',
                  sessionId: sessionId,
                  sessionName: session.name,
                  breakpointId: bpId,
                  file: newBreakpoint.file,
                  line: newBreakpoint.line,
                  verified: true,
                  timestamp: Date.now()
                });
              }
          }
      } catch (error) {
          this.logger.error(`[SessionManager] Error sending setBreakpoint to proxy for session ${sessionId}:`, error);
      }
    }
    return newBreakpoint;
  }

  async stepOver(sessionId: string): Promise<DebugResult> {
    const session = this._getSessionById(sessionId);
    const threadId = session.proxyManager?.getCurrentThreadId();
    this.logger.info(`[SM stepOver ${sessionId}] Entered. Current state: ${session.state}, ThreadID: ${threadId}`);
    
    if (!session.proxyManager || !session.proxyManager.isRunning()) {
      return { success: false, error: 'No active debug run', state: session.state };
    }
    if (session.state !== SessionState.PAUSED) {
      this.logger.warn(`[SM stepOver ${sessionId}] Not paused. State: ${session.state}`);
      return { success: false, error: 'Not paused', state: session.state };
    }
    if (!threadId) {
      this.logger.warn(`[SM stepOver ${sessionId}] No current thread ID.`);
      return { success: false, error: 'No current thread ID', state: session.state };
    }
    
    this.logger.info(`[SM stepOver ${sessionId}] Sending DAP 'next' for threadId ${threadId}`);
    
    try {
      // Send step request
      await session.proxyManager.sendDapRequest('next', { threadId });
      
      // Update state to running
      this._updateSessionState(session, SessionState.RUNNING);
      
      // Wait for stopped event
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          this.logger.warn(`[SM stepOver ${sessionId}] Timeout waiting for stopped event`);
          resolve({ 
            success: false, 
            error: ErrorMessages.stepTimeout(5), 
            state: session.state 
          });
        }, 5000);
        
        session.proxyManager?.once('stopped', () => {
          clearTimeout(timeout);
          this.logger.info(`[SM stepOver ${sessionId}] Step completed. Current state: ${session.state}`);
          resolve({ success: true, state: session.state, data: { message: "Step over completed." } });
        });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[SM stepOver ${sessionId}] Error during step:`, error);
      this._updateSessionState(session, SessionState.ERROR);
      return { success: false, error: errorMessage, state: session.state };
    }
  }

  async stepInto(sessionId: string): Promise<DebugResult> {
    const session = this._getSessionById(sessionId);
    const threadId = session.proxyManager?.getCurrentThreadId();
    this.logger.info(`[SM stepInto ${sessionId}] Entered. Current state: ${session.state}, ThreadID: ${threadId}`);
    
    if (!session.proxyManager || !session.proxyManager.isRunning()) {
      return { success: false, error: 'No active debug run', state: session.state };
    }
    if (session.state !== SessionState.PAUSED) {
      this.logger.warn(`[SM stepInto ${sessionId}] Not paused. State: ${session.state}`);
      return { success: false, error: 'Not paused', state: session.state };
    }
    if (!threadId) {
      this.logger.warn(`[SM stepInto ${sessionId}] No current thread ID.`);
      return { success: false, error: 'No current thread ID', state: session.state };
    }
    
    this.logger.info(`[SM stepInto ${sessionId}] Sending DAP 'stepIn' for threadId ${threadId}`);
    
    try {
      // Send step request
      await session.proxyManager.sendDapRequest('stepIn', { threadId });
      
      // Update state to running
      this._updateSessionState(session, SessionState.RUNNING);
      
      // Wait for stopped event
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          this.logger.warn(`[SM stepInto ${sessionId}] Timeout waiting for stopped event`);
          resolve({ 
            success: false, 
            error: ErrorMessages.stepTimeout(5), 
            state: session.state 
          });
        }, 5000);
        
        session.proxyManager?.once('stopped', () => {
          clearTimeout(timeout);
          this.logger.info(`[SM stepInto ${sessionId}] Step completed. Current state: ${session.state}`);
          resolve({ success: true, state: session.state, data: { message: "Step into completed." } });
        });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[SM stepInto ${sessionId}] Error during step:`, error);
      this._updateSessionState(session, SessionState.ERROR);
      return { success: false, error: errorMessage, state: session.state };
    }
  }

  async stepOut(sessionId: string): Promise<DebugResult> {
    const session = this._getSessionById(sessionId);
    const threadId = session.proxyManager?.getCurrentThreadId();
    this.logger.info(`[SM stepOut ${sessionId}] Entered. Current state: ${session.state}, ThreadID: ${threadId}`);
    
    if (!session.proxyManager || !session.proxyManager.isRunning()) {
      return { success: false, error: 'No active debug run', state: session.state };
    }
    if (session.state !== SessionState.PAUSED) {
      this.logger.warn(`[SM stepOut ${sessionId}] Not paused. State: ${session.state}`);
      return { success: false, error: 'Not paused', state: session.state };
    }
    if (!threadId) {
      this.logger.warn(`[SM stepOut ${sessionId}] No current thread ID.`);
      return { success: false, error: 'No current thread ID', state: session.state };
    }
    
    this.logger.info(`[SM stepOut ${sessionId}] Sending DAP 'stepOut' for threadId ${threadId}`);
    
    try {
      // Send step request
      await session.proxyManager.sendDapRequest('stepOut', { threadId });
      
      // Update state to running
      this._updateSessionState(session, SessionState.RUNNING);
      
      // Wait for stopped event
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          this.logger.warn(`[SM stepOut ${sessionId}] Timeout waiting for stopped event`);
          resolve({ 
            success: false, 
            error: ErrorMessages.stepTimeout(5), 
            state: session.state 
          });
        }, 5000);
        
        session.proxyManager?.once('stopped', () => {
          clearTimeout(timeout);
          this.logger.info(`[SM stepOut ${sessionId}] Step completed. Current state: ${session.state}`);
          resolve({ success: true, state: session.state, data: { message: "Step out completed." } });
        });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[SM stepOut ${sessionId}] Error during step:`, error);
      this._updateSessionState(session, SessionState.ERROR);
      return { success: false, error: errorMessage, state: session.state };
    }
  }

  async continue(sessionId: string): Promise<DebugResult> {
    const session = this._getSessionById(sessionId);
    const threadId = session.proxyManager?.getCurrentThreadId();
    this.logger.info(`[SessionManager continue] Called for session ${sessionId}. Current state: ${session.state}, ThreadID: ${threadId}`);
    
    if (!session.proxyManager || !session.proxyManager.isRunning()) {
      this.logger.warn(`[SessionManager continue] No active debug run for session ${sessionId}.`);
      return { success: false, error: 'No active debug run', state: session.state };
    }
    if (session.state !== SessionState.PAUSED) {
      this.logger.warn(`[SessionManager continue] Session ${sessionId} not paused. State: ${session.state}.`);
      return { success: false, error: 'Not paused', state: session.state };
    }
    if (!threadId) {
      this.logger.warn(`[SessionManager continue] No current thread ID for session ${sessionId}.`);
      return { success: false, error: 'No current thread ID', state: session.state };
    }
    
    try {
      this.logger.info(`[SessionManager continue] Sending DAP 'continue' for session ${sessionId}, threadId ${threadId}.`);
      await session.proxyManager.sendDapRequest('continue', { threadId });
      this._updateSessionState(session, SessionState.RUNNING);
      this.logger.info(`[SessionManager continue] DAP 'continue' sent, session ${sessionId} state updated to RUNNING.`);
      return { success: true, state: session.state };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[SessionManager continue] Error sending 'continue' to proxy for session ${sessionId}: ${errorMessage}`);
      throw error; 
    }
  }
  
  async getVariables(sessionId: string, variablesReference: number): Promise<Variable[]> {
    const session = this._getSessionById(sessionId);
    this.logger.info(`[SM getVariables ${sessionId}] Entered. variablesReference: ${variablesReference}, Current state: ${session.state}`);
    
    if (!session.proxyManager || !session.proxyManager.isRunning()) { 
      this.logger.warn(`[SM getVariables ${sessionId}] No active proxy.`); 
      return []; 
    }
    if (session.state !== SessionState.PAUSED) { 
      this.logger.warn(`[SM getVariables ${sessionId}] Session not paused. State: ${session.state}.`); 
      return []; 
    }
    
    try {
      this.logger.info(`[SM getVariables ${sessionId}] Sending DAP 'variables' for variablesReference ${variablesReference}.`);
      const response = await session.proxyManager.sendDapRequest<DebugProtocol.VariablesResponse>('variables', { variablesReference });
      this.logger.info(`[SM getVariables ${sessionId}] DAP 'variables' response received. Body:`, response?.body);

      if (response && response.body && response.body.variables) {
        const vars = response.body.variables.map((v: DebugProtocol.Variable) => ({ 
            name: v.name, value: v.value, type: v.type || "<unknown_type>", 
            variablesReference: v.variablesReference,
            expandable: v.variablesReference > 0 
        }));
        this.logger.info(`[SM getVariables ${sessionId}] Parsed variables:`, vars.map(v => ({name: v.name, value: v.value, type: v.type}))); 
        return vars;
      }
      this.logger.warn(`[SM getVariables ${sessionId}] No variables in response body for reference ${variablesReference}. Response:`, response);
      return [];
    } catch (error) {
      this.logger.error(`[SM getVariables ${sessionId}] Error getting variables:`, error);
      return [];
    }
  }

  async getStackTrace(sessionId: string, threadId?: number): Promise<StackFrame[]> {
    const session = this._getSessionById(sessionId);
    const currentThreadId = session.proxyManager?.getCurrentThreadId();
    this.logger.info(`[SM getStackTrace ${sessionId}] Entered. Requested threadId: ${threadId}, Current state: ${session.state}, Actual currentThreadId: ${currentThreadId}`);
    
    if (!session.proxyManager || !session.proxyManager.isRunning()) { 
      this.logger.warn(`[SM getStackTrace ${sessionId}] No active proxy.`); 
      return []; 
    }
    if (session.state !== SessionState.PAUSED) { 
      this.logger.warn(`[SM getStackTrace ${sessionId}] Session not paused. State: ${session.state}.`); 
      return []; 
    }
    
    const currentThreadForRequest = threadId || currentThreadId;
    if (!currentThreadForRequest) { 
      this.logger.warn(`[SM getStackTrace ${sessionId}] No effective thread ID to use.`); 
      return []; 
    }

    try {
      this.logger.info(`[SM getStackTrace ${sessionId}] Sending DAP 'stackTrace' for threadId ${currentThreadForRequest}.`);
      const response = await session.proxyManager.sendDapRequest<DebugProtocol.StackTraceResponse>('stackTrace', { threadId: currentThreadForRequest });
      this.logger.info(`[SM getStackTrace ${sessionId}] DAP 'stackTrace' response received. Body:`, response?.body);
      
      if (response && response.body && response.body.stackFrames) {
        const frames = response.body.stackFrames.map((sf: DebugProtocol.StackFrame) => ({ 
            id: sf.id, name: sf.name, 
            file: sf.source?.path || sf.source?.name || "<unknown_source>", 
            line: sf.line, column: sf.column
        }));
        this.logger.info(`[SM getStackTrace ${sessionId}] Parsed stack frames (top 3):`, frames.slice(0,3).map(f => ({name:f.name, file:f.file, line:f.line})));
        return frames;
      }
      this.logger.warn(`[SM getStackTrace ${sessionId}] No stackFrames in response body. Response:`, response);
      return [];
    } catch (error) {
      this.logger.error(`[SM getStackTrace ${sessionId}] Error getting stack trace:`, error);
      return [];
    }
  }

  async getScopes(sessionId: string, frameId: number): Promise<DebugProtocol.Scope[]> {
    const session = this._getSessionById(sessionId);
    this.logger.info(`[SM getScopes ${sessionId}] Entered. frameId: ${frameId}, Current state: ${session.state}`);
    
    if (!session.proxyManager || !session.proxyManager.isRunning()) { 
      this.logger.warn(`[SM getScopes ${sessionId}] No active proxy.`); 
      return []; 
    }
    if (session.state !== SessionState.PAUSED) { 
      this.logger.warn(`[SM getScopes ${sessionId}] Session not paused. State: ${session.state}.`); 
      return []; 
    }
    
    try {
      this.logger.info(`[SM getScopes ${sessionId}] Sending DAP 'scopes' for frameId ${frameId}.`);
      const response = await session.proxyManager.sendDapRequest<DebugProtocol.ScopesResponse>('scopes', { frameId });
      this.logger.info(`[SM getScopes ${sessionId}] DAP 'scopes' response received. Body:`, response?.body);
      
      if (response && response.body && response.body.scopes) {
        this.logger.info(`[SM getScopes ${sessionId}] Parsed scopes:`, response.body.scopes.map(s => ({name: s.name, ref: s.variablesReference, expensive: s.expensive })));
        return response.body.scopes;
      }
      this.logger.warn(`[GetScopes] No scopes in response body for session ${sessionId}, frameId ${frameId}. Response:`, response);
      return [];
    } catch (error) {
      this.logger.error(`[SM getScopes ${sessionId}] Error getting scopes:`, error);
      return [];
    }
  }
  
  public getSession(sessionId: string): ManagedSession | undefined { 
    return this.sessionStore.get(sessionId); 
  }
  
  public getAllSessions(): DebugSessionInfo[] { 
    return this.sessionStore.getAll();
  }
  
  async closeSession(sessionId: string): Promise<boolean> {
    const session = this.sessionStore.get(sessionId); 
    if (!session) {
      this.logger.warn(`[SESSION_CLOSE_FAIL] Session not found: ${sessionId}`);
      return false;
    }
    this.logger.info(`Closing debug session: ${sessionId}. Active proxy: ${session.proxyManager ? 'yes' : 'no'}`);
    
    if (session.proxyManager) {
      // Always cleanup listeners first
      try {
        this.cleanupProxyEventHandlers(session, session.proxyManager);
      } catch (cleanupError) {
        this.logger.error(`[SessionManager] Critical error during listener cleanup for session ${sessionId}:`, cleanupError);
        // Continue with session closure despite cleanup errors
      }
      
      // Then stop the proxy
      try {
        await session.proxyManager.stop();
      } catch (error: unknown) { 
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[SessionManager] Error stopping proxy for session ${sessionId}:`, message);
      } finally {
        session.proxyManager = undefined;
      }
    }
    
    this._updateSessionState(session, SessionState.STOPPED);
    this.logger.info(`Session ${sessionId} marked as STOPPED.`);
    return true;
  }

  async closeAllSessions(): Promise<void> {
    this.logger.info(`Closing all debug sessions (${this.sessionStore.size()} active)`);
    const sessions = this.sessionStore.getAllManaged();
    for (const session of sessions) {
      await this.closeSession(session.id);
    }
    this.logger.info('All debug sessions closed');
  }

  /**
   * @internal - This is for testing only, do not use in production
   */
  public _testOnly_cleanupProxyEventHandlers(session: ManagedSession, proxyManager: IProxyManager): void {
    return this.cleanupProxyEventHandlers(session, proxyManager);
  }
}
