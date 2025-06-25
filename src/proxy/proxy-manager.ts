/**
 * ProxyManager - Handles spawning and communication with debug proxy processes
 */
import { EventEmitter } from 'events';
import { DebugProtocol } from '@vscode/debugprotocol';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  IFileSystem,
  ILogger
} from '../interfaces/external-dependencies.js';
import { IProxyProcessLauncher, IProxyProcess } from '../interfaces/process-interfaces.js';
import { 
  createInitialState, 
  handleProxyMessage, 
  isValidProxyMessage,
  DAPSessionState
} from '../dap-core/index.js';
import { ErrorMessages } from '../utils/error-messages.js';

/**
 * Configuration for starting a proxy
 */
export interface ProxyConfig {
  sessionId: string;
  pythonPath: string;
  adapterHost: string;
  adapterPort: number;
  logDir: string;
  scriptPath: string;
  scriptArgs?: string[];
  stopOnEntry?: boolean;
  justMyCode?: boolean;
  initialBreakpoints?: Array<{ file: string; line: number; condition?: string }>;
  dryRunSpawn?: boolean;
}

/**
 * Events emitted by ProxyManager
 */
export interface ProxyManagerEvents {
  // DAP events
  'stopped': (threadId: number, reason: string, data?: DebugProtocol.StoppedEvent['body']) => void;
  'continued': () => void;
  'terminated': () => void;
  'exited': () => void;
  
  // Proxy lifecycle events
  'initialized': () => void;
  'error': (error: Error) => void;
  'exit': (code: number | null, signal?: string) => void;
  
  // Status events
  'dry-run-complete': (command: string, script: string) => void;
  'adapter-configured': () => void;
  'dap-event': (event: string, body: unknown) => void;
}

/**
 * Interface for proxy managers
 */
export interface IProxyManager extends EventEmitter {
  start(config: ProxyConfig): Promise<void>;
  stop(): Promise<void>;
  sendDapRequest<T extends DebugProtocol.Response>(
    command: string, 
    args?: unknown
  ): Promise<T>;
  isRunning(): boolean;
  getCurrentThreadId(): number | null;
  
  // Typed event emitter methods
  on<K extends keyof ProxyManagerEvents>(
    event: K, 
    listener: ProxyManagerEvents[K]
  ): this;
  emit<K extends keyof ProxyManagerEvents>(
    event: K, 
    ...args: Parameters<ProxyManagerEvents[K]>
  ): boolean;
}

// Message types from proxy
type ProxyStatusMessage = 
  | { type: 'status'; sessionId: string; status: 'proxy_minimal_ran_ipc_test'; message?: string }
  | { type: 'status'; sessionId: string; status: 'dry_run_complete'; command: string; script: string; data?: unknown }
  | { type: 'status'; sessionId: string; status: 'adapter_configured_and_launched'; data?: unknown }
  | { type: 'status'; sessionId: string; status: 'adapter_exited' | 'dap_connection_closed' | 'terminated'; code?: number | null; signal?: NodeJS.Signals | null; data?: unknown };

type ProxyDapEventMessage = { 
  type: 'dapEvent'; 
  sessionId: string; 
  event: string; 
  body?: unknown; 
  data?: unknown 
};

type ProxyDapResponseMessage = { 
  type: 'dapResponse'; 
  sessionId: string; 
  requestId: string; 
  success: boolean; 
  response?: DebugProtocol.Response; 
  body?: unknown; 
  error?: string;
  data?: unknown;
};

type ProxyErrorMessage = { 
  type: 'error'; 
  sessionId: string; 
  message: string; 
  data?: unknown 
};

type ProxyMessage = ProxyStatusMessage | ProxyDapEventMessage | ProxyDapResponseMessage | ProxyErrorMessage;

/**
 * Concrete implementation of ProxyManager
 */
export class ProxyManager extends EventEmitter implements IProxyManager {
  private proxyProcess: IProxyProcess | null = null;
  private sessionId: string | null = null;
  private currentThreadId: number | null = null;
  private pendingDapRequests = new Map<string, {
    resolve: (response: DebugProtocol.Response) => void;
    reject: (error: Error) => void;
    command: string;
  }>();
  private isInitialized = false;
  private isDryRun = false;
  private adapterConfigured = false;
  private dapState: DAPSessionState | null = null;
  private stderrBuffer: string[] = [];

  constructor(
    private proxyProcessLauncher: IProxyProcessLauncher,
    private fileSystem: IFileSystem,
    private logger: ILogger
  ) {
    super();
  }

  async start(config: ProxyConfig): Promise<void> {
    if (this.proxyProcess) {
      throw new Error('Proxy already running');
    }

    this.sessionId = config.sessionId;
    this.isDryRun = config.dryRunSpawn === true;
    
    // Initialize functional core state
    this.dapState = createInitialState(config.sessionId);
    
    // Find proxy bootstrap script
    const proxyScriptPath = await this.findProxyScript();
    
    // Prepare environment
    // In container environments, use /app as the working directory to avoid double slash issues
    const projectRootForEnv = process.env.MCP_CONTAINER === 'true' 
      ? '/app' 
      : path.resolve(fileURLToPath(import.meta.url), '../../../');
    const env = { ...process.env, MCP_SERVER_CWD: projectRootForEnv };

    this.logger.info(`[ProxyManager] Spawning proxy for session ${config.sessionId}. Path: ${proxyScriptPath}`);
    
    try {
      this.proxyProcess = this.proxyProcessLauncher.launchProxy(
        proxyScriptPath,
        config.sessionId,
        env
      );
    } catch (error) {
      this.logger.error(`[ProxyManager] Failed to spawn proxy:`, error);
      throw error;
    }

    if (!this.proxyProcess || typeof this.proxyProcess.pid === 'undefined') {
      throw new Error('Proxy process is invalid or PID is missing');
    }

    this.logger.info(`[ProxyManager] Proxy spawned with PID: ${this.proxyProcess.pid}`);
    
    // Set up event handlers
    this.setupEventHandlers();

    // Send initialization command
    this.sendCommand({
      cmd: 'init',
      sessionId: config.sessionId,
      pythonPath: config.pythonPath,
      adapterHost: config.adapterHost,
      adapterPort: config.adapterPort,
      logDir: config.logDir,
      scriptPath: config.scriptPath,
      scriptArgs: config.scriptArgs,
      stopOnEntry: config.stopOnEntry,
      justMyCode: config.justMyCode,
      initialBreakpoints: config.initialBreakpoints,
      dryRunSpawn: config.dryRunSpawn
    });

    // Wait for initialization or dry run completion
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(ErrorMessages.proxyInitTimeout(30)));
      }, 30000);

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('initialized', handleInitialized);
        this.removeListener('dry-run-complete', handleDryRun);
        this.removeListener('error', handleError);
        this.removeListener('exit', handleExit);
      };

      const handleInitialized = () => {
        this.isInitialized = true;
        cleanup();
        resolve();
      };

      const handleDryRun = () => {
        cleanup();
        resolve();
      };

      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const handleExit = (code: number | null, signal?: string) => {
        cleanup();
        if (this.isDryRun && code === 0) {
          // Normal exit for dry run
          resolve();
        } else {
          let errorMessage = `Proxy exited during initialization. Code: ${code}, Signal: ${signal}`;
          if (this.stderrBuffer.length > 0) {
            errorMessage += `\nStderr output:\n${this.stderrBuffer.join('\n')}`;
          }
          reject(new Error(errorMessage));
        }
      };

      this.once('initialized', handleInitialized);
      this.once('dry-run-complete', handleDryRun);
      this.once('error', handleError);
      this.once('exit', handleExit);
    });
  }

  async stop(): Promise<void> {
    if (!this.proxyProcess) {
      return;
    }

    this.logger.info(`[ProxyManager] Stopping proxy for session ${this.sessionId}`);

    // Send terminate command
    try {
      this.sendCommand({ cmd: 'terminate' });
    } catch (error) {
      this.logger.error(`[ProxyManager] Error sending terminate command:`, error);
    }

    // Wait for graceful exit or force kill after timeout
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.logger.warn(`[ProxyManager] Timeout waiting for proxy exit. Force killing.`);
        this.proxyProcess?.kill('SIGKILL');
        resolve();
      }, 5000);

      this.proxyProcess?.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  async sendDapRequest<T extends DebugProtocol.Response>(
    command: string, 
    args?: unknown
  ): Promise<T> {
    if (!this.proxyProcess || !this.isInitialized) {
      throw new Error('Proxy not initialized');
    }

    const requestId = uuidv4();
    const commandToSend = {
      cmd: 'dap',
      sessionId: this.sessionId,
      requestId,
      dapCommand: command,
      dapArgs: args
    };

    this.logger.info(`[ProxyManager] Sending DAP command: ${command}, requestId: ${requestId}`);

    return new Promise<T>((resolve, reject) => {
      this.pendingDapRequests.set(requestId, {
        resolve: resolve as (value: DebugProtocol.Response) => void,
        reject,
        command
      });

      try {
        this.sendCommand(commandToSend);
      } catch (error) {
        this.pendingDapRequests.delete(requestId);
        reject(error);
      }

      // Timeout handler
      setTimeout(() => {
        if (this.pendingDapRequests.has(requestId)) {
          this.pendingDapRequests.delete(requestId);
          reject(new Error(ErrorMessages.dapRequestTimeout(command, 35)));
        }
      }, 35000);
    });
  }

  isRunning(): boolean {
    return this.proxyProcess !== null && !this.proxyProcess.killed;
  }

  getCurrentThreadId(): number | null {
    return this.currentThreadId;
  }

  private async findProxyScript(): Promise<string> {
    // Check if we're running from a bundled environment
    const isBundled = fileURLToPath(import.meta.url).includes('bundle.cjs');
    
    let distPath: string;
    if (isBundled) {
      // In bundled environment (e.g., Docker container), proxy-bootstrap.js is in same dist directory
      distPath = path.resolve(process.cwd(), 'dist/proxy/proxy-bootstrap.js');
    } else {
      // In development/non-bundled environment, resolve relative to this module's location
      const moduleDir = path.dirname(fileURLToPath(import.meta.url));
      distPath = path.resolve(moduleDir, '../../dist/proxy/proxy-bootstrap.js');
    }
    
    this.logger.info(`[ProxyManager] Checking for proxy script at: ${distPath} (bundled: ${isBundled})`);
    
    if (!(await this.fileSystem.pathExists(distPath))) {
      const moduleDir = path.dirname(fileURLToPath(import.meta.url));
      throw new Error(
        `Bootstrap worker script not found at: ${distPath}\n` +
        `Module directory: ${moduleDir}\n` +
        `Current working directory: ${process.cwd()}\n` +
        `Is bundled: ${isBundled}\n` +
        `This usually means:\n` +
        `  1. You need to run 'npm run build' first\n` +
        `  2. The build failed to copy proxy files\n` +
        `  3. The TypeScript compilation structure is unexpected`
      );
    }
    
    return distPath;
  }

  private sendCommand(command: object): void {
    if (!this.proxyProcess || this.proxyProcess.killed) {
      throw new Error('Proxy process not available');
    }
    
    this.proxyProcess.sendCommand(command);
  }

  private setupEventHandlers(): void {
    if (!this.proxyProcess) return;

    // Handle IPC messages
    this.proxyProcess.on('message', (rawMessage: unknown) => {
      this.handleProxyMessage(rawMessage);
    });

    // Handle stderr
    this.proxyProcess.stderr?.on('data', (data: Buffer | string) => {
      const output = data.toString().trim();
      this.logger.error(`[ProxyManager STDERR] ${output}`);
      // Capture stderr for error reporting during initialization
      if (!this.isInitialized) {
        this.stderrBuffer.push(output);
      }
    });

    // Handle exit
    this.proxyProcess.on('exit', (code: number | null, signal: string | null) => {
      this.logger.info(`[ProxyManager] Proxy exited. Code: ${code}, Signal: ${signal}`);
      this.handleProxyExit(code, signal);
    });

    // Handle errors
    this.proxyProcess.on('error', (err: Error) => {
      this.logger.error(`[ProxyManager] Proxy error:`, err);
      this.emit('error', err);
      this.cleanup();
    });
  }

  private handleProxyMessage(rawMessage: unknown): void {
    this.logger.debug(`[ProxyManager] Received message:`, rawMessage);

    // Validate message format
    if (!isValidProxyMessage(rawMessage)) {
      this.logger.warn(`[ProxyManager] Invalid message format:`, rawMessage);
      return;
    }

    const message = rawMessage as ProxyMessage;

    // Use functional core if state is initialized
    if (this.dapState) {
      const result = handleProxyMessage(this.dapState, message);
      
      // Execute commands from functional core
      for (const command of result.commands) {
        switch (command.type) {
          case 'log':
            this.logger[command.level](command.message, command.data);
            break;
            
          case 'emitEvent':
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Event args must support variable argument counts, any[] required for spread operator
            this.emit(command.event as keyof ProxyManagerEvents, ...(command.args as [any, any]));
            break;
            
          case 'killProcess':
            this.proxyProcess?.kill();
            break;
            
          case 'sendToProxy':
            this.sendCommand(command.command);
            break;
            
          // Note: sendToClient is not used in ProxyManager context
        }
      }
      
      // Update state if changed
      if (result.newState) {
        this.dapState = result.newState;
        
        // Sync local state with functional core state
        this.isInitialized = result.newState.initialized;
        this.adapterConfigured = result.newState.adapterConfigured;
        this.currentThreadId = result.newState.currentThreadId ?? null;
      }
      
      // Handle pending DAP responses (still done imperatively for now)
      if (message.type === 'dapResponse') {
        this.handleDapResponse(message as ProxyDapResponseMessage);
      }
    } else {
      // Fallback if state not initialized (shouldn't happen)
      this.logger.error(`[ProxyManager] DAP state not initialized`);
    }
  }

  private handleDapResponse(message: ProxyDapResponseMessage): void {
    const pending = this.pendingDapRequests.get(message.requestId);
    if (!pending) {
      this.logger.warn(`[ProxyManager] Received response for unknown request: ${message.requestId}`);
      return;
    }

    this.pendingDapRequests.delete(message.requestId);

    if (message.success) {
      pending.resolve((message.response || message.body) as DebugProtocol.Response);
    } else {
      pending.reject(new Error(message.error || `DAP request '${pending.command}' failed`));
    }
  }

  private handleDapEvent(message: ProxyDapEventMessage): void {
    this.logger.info(`[ProxyManager] DAP event: ${message.event}`, message.body);

    switch (message.event) {
      case 'stopped':
        const stoppedBody = message.body as { threadId?: number; reason?: string } | undefined;
        const threadId = stoppedBody?.threadId || 0;
        const reason = stoppedBody?.reason || 'unknown';
        if (threadId) {
          this.currentThreadId = threadId;
        }
        this.emit('stopped', threadId, reason, stoppedBody as DebugProtocol.StoppedEvent['body']);
        break;
      
      case 'continued':
        this.emit('continued');
        break;
      
      case 'terminated':
        this.emit('terminated');
        break;
      
      case 'exited':
        this.emit('exited');
        break;
      
      // Forward other events as generic DAP events
      default:
        this.emit('dap-event', message.event, message.body);
    }
  }

  private handleStatusMessage(message: ProxyStatusMessage): void {
    switch (message.status) {
      case 'proxy_minimal_ran_ipc_test':
        this.logger.info(`[ProxyManager] IPC test message received`);
        this.proxyProcess?.kill();
        break;
      
      case 'dry_run_complete':
        this.logger.info(`[ProxyManager] Dry run complete`);
        this.emit('dry-run-complete', message.command, message.script);
        break;
      
      case 'adapter_configured_and_launched':
        this.logger.info(`[ProxyManager] Adapter configured and launched`);
        this.adapterConfigured = true;
        this.emit('adapter-configured');
        if (!this.isInitialized) {
          this.isInitialized = true;
          this.emit('initialized');
        }
        break;
      
      case 'adapter_exited':
      case 'dap_connection_closed':
      case 'terminated':
        this.logger.info(`[ProxyManager] Status: ${message.status}`);
        this.emit('exit', message.code || 1, message.signal || undefined);
        break;
    }
  }

  private handleProxyExit(code: number | null, signal: string | null): void {
    // Clean up pending requests
    this.pendingDapRequests.forEach(pending => {
      pending.reject(new Error('Proxy exited'));
    });
    this.pendingDapRequests.clear();

    // Emit exit event
    this.emit('exit', code, signal || undefined);

    // Clean up
    this.cleanup();
  }

  private cleanup(): void {
    this.proxyProcess = null;
    this.isInitialized = false;
    this.adapterConfigured = false;
    this.currentThreadId = null;
  }
}
