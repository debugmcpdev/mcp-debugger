/**
 * Process management for debugpy adapter
 */

import { ChildProcess } from 'child_process';
import {
  IProcessSpawner,
  ILogger,
  IFileSystem,
  AdapterConfig,
  AdapterSpawnResult
} from './dap-proxy-interfaces.js';

export class DebugpyAdapterManager {
  constructor(
    private processSpawner: IProcessSpawner,
    private logger: ILogger,
    private fileSystem: IFileSystem
  ) {}

  /**
   * Build the command and arguments for spawning debugpy adapter
   */
  buildSpawnCommand(pythonPath: string, host: string, port: number, logDir: string): {
    command: string;
    args: string[];
  } {
    const args = [
      '-m', 'debugpy.adapter',
      '--host', host,
      '--port', String(port),
      '--log-dir', logDir
    ];

    return {
      command: pythonPath,
      args
    };
  }

  /**
   * Ensure the log directory exists
   */
  async ensureLogDirectory(logDir: string): Promise<void> {
    try {
      await this.fileSystem.ensureDir(logDir);
      this.logger.info(`[AdapterManager] Ensured adapter log directory exists: ${logDir}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[AdapterManager] Failed to ensure adapter log directory ${logDir}:`, error);
      throw new Error(`Failed to create adapter log directory: ${message}`);
    }
  }

  /**
   * Spawn the debugpy adapter process
   */
  async spawn(config: AdapterConfig): Promise<AdapterSpawnResult> {
    const { pythonPath, host, port, logDir, cwd, env } = config;

    // Ensure log directory exists
    await this.ensureLogDirectory(logDir);

    // Build spawn command
    const { command, args } = this.buildSpawnCommand(pythonPath, host, port, logDir);
    const fullCommand = `${command} ${args.join(' ')}`;
    
    this.logger.info(`[AdapterManager] Spawning debugpy.adapter: ${fullCommand}`);
    
    // Determine working directory
    const preferredCwd = cwd || process.env.MCP_SERVER_CWD || process.cwd();
    
    // Spawn options
    const spawnOptions = {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'] as ('ignore' | 'pipe' | 'inherit' | 'ipc' | number)[],
      cwd: preferredCwd,
      env: env || process.env,
      detached: true
    };

    this.logger.info('[AdapterManager] Spawn configuration:', {
      execPath: command,
      args: args,
      cwd: spawnOptions.cwd,
      envVars: Object.keys(spawnOptions.env || {}).length
    });

    // Spawn the process
    const adapterProcess = this.processSpawner.spawn(command, args, spawnOptions);

    if (!adapterProcess || !adapterProcess.pid) {
      throw new Error('Failed to spawn debugpy adapter process or get PID');
    }

    // Detach the process
    adapterProcess.unref();
    this.logger.info(`[AdapterManager] Called unref() on adapter process PID: ${adapterProcess.pid}`);

    // Set up error handlers
    this.setupProcessHandlers(adapterProcess);

    return {
      process: adapterProcess,
      pid: adapterProcess.pid
    };
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(process: ChildProcess): void {
    process.on('error', (err: Error) => {
      this.logger.error('[AdapterManager] Adapter process spawn error:', err);
    });

    process.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.logger.info(`[AdapterManager] Adapter process exited. Code: ${code}, Signal: ${signal}`);
    });
  }

  /**
   * Gracefully shutdown an adapter process
   */
  async shutdown(process: ChildProcess | null): Promise<void> {
    if (!process || !process.pid) {
      this.logger.info('[AdapterManager] No active adapter process to terminate.');
      return;
    }

    this.logger.info(`[AdapterManager] Attempting to terminate adapter process PID: ${process.pid}`);

    try {
      if (!process.killed) {
        this.logger.info(`[AdapterManager] Sending SIGTERM to adapter process PID: ${process.pid}`);
        process.kill('SIGTERM');

        // Wait a short period for graceful exit
        await new Promise(resolve => setTimeout(resolve, 300));

        if (!process.killed) {
          this.logger.warn(`[AdapterManager] Adapter process PID: ${process.pid} did not exit after SIGTERM. Sending SIGKILL.`);
          process.kill('SIGKILL');
        } else {
          this.logger.info(`[AdapterManager] Adapter process PID: ${process.pid} exited after SIGTERM.`);
        }
      } else {
        this.logger.info(`[AdapterManager] Adapter process PID: ${process.pid} was already marked as killed.`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`[AdapterManager] Error during adapter process termination (PID: ${process.pid}): ${message}`, e);
    }
  }

  /**
   * Validate Python path exists (optional utility)
   */
  async validatePythonPath(pythonPath: string): Promise<boolean> {
    try {
      // Try to spawn python --version to validate
      const testProcess = this.processSpawner.spawn(pythonPath, ['--version'], {
        stdio: 'ignore'
      });

      return new Promise((resolve) => {
        testProcess.on('error', () => resolve(false));
        testProcess.on('exit', (code) => resolve(code === 0));
      });
    } catch {
      return false;
    }
  }
}
