import path from 'path';
import { IFileSystem, ILogger, IEnvironment } from '../interfaces/external-dependencies.js';

export class PathTranslator {
  private isContainer: boolean;
  private logger: ILogger;
  private fileSystem: IFileSystem;
  private environment: IEnvironment;

  constructor(fileSystem: IFileSystem, logger: ILogger, environment: IEnvironment) {
    this.fileSystem = fileSystem;
    this.logger = logger;
    this.environment = environment;
    this.isContainer = this.environment.get('MCP_CONTAINER') === 'true';
    
    // Test expects "PathTranslator initialized" to be contained in the message
    this.logger.info(`PathTranslator initialized in ${this.isContainer ? 'container' : 'host'} mode`);
  }

  isContainerMode(): boolean {
    return this.isContainer;
  }

  /**
   * Get the workspace root directory
   * In host mode: returns the current working directory
   * In container mode: returns '/workspace'
   */
  getWorkspaceRoot(): string {
    if (this.isContainer) {
      return '/workspace';
    }
    return this.environment.getCurrentWorkingDirectory();
  }

  translatePath(inputPath: string): string {
    this.logger.debug(`[PathTranslator] Translating path: ${inputPath}`);
    
    if (!this.isContainer) {
      // Host mode: resolve relative paths from CWD, use absolute paths as-is
      if (path.isAbsolute(inputPath)) {
        return inputPath;
      }
      
      // Handle empty string - return current working directory
      if (!inputPath) {
        return this.environment.getCurrentWorkingDirectory();
      }
      
      const cwd = this.environment.getCurrentWorkingDirectory();
      
      // Use path.resolve to get the expected behavior
      const resolvedPath = path.resolve(cwd, inputPath);
      
      // Check if file exists
      if (!this.fileSystem.existsSync(resolvedPath)) {
        throw new Error(
          `Could not find file at resolved path: ${resolvedPath}. ` +
          `Attempted to resolve relative path: ${inputPath}. ` +
          `Using workspace root: ${cwd}. ` +
          `Please use absolute paths or ensure relative paths are correct from ${cwd}.`
        );
      }
      
      return resolvedPath;
    }
    
    // Container mode: handle paths relative to /workspace
    
    // Handle empty string
    if (!inputPath) {
      return '/workspace';
    }
    
    // Normalize Windows backslashes to forward slashes
    const normalizedPath = inputPath.replace(/\\/g, '/');
    
    // Handle case where path already starts with /workspace
    if (normalizedPath.startsWith('/workspace')) {
      return normalizedPath;
    }
    
    // Reject absolute paths in container mode
    if (path.isAbsolute(inputPath)) {
      throw new Error(
        `Absolute paths are not supported in container mode.\n` +
        `Path provided: ${inputPath}\n` +
        `Please use relative paths (they will be resolved from /workspace).`
      );
    }
    
    // Manually join to preserve .. segments
    // Remove leading ./ if present
    let cleanPath = normalizedPath;
    if (cleanPath.startsWith('./')) {
      cleanPath = cleanPath.substring(2);
    }
    
    // Ensure proper joining with single slash
    if (cleanPath.startsWith('/')) {
      return '/workspace' + cleanPath;
    } else {
      return '/workspace/' + cleanPath;
    }
  }
}
