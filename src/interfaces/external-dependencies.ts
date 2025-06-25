/**
 * External dependency interfaces for dependency injection and testing
 * These interfaces mirror the actual external dependencies used in the codebase
 * to enable easy mocking and testing without changing implementation.
 */

import { EventEmitter } from 'events';
import { SpawnOptions } from 'child_process';
import { Stats } from 'fs';
import type { IProxyManager } from '../proxy/proxy-manager.js';

/**
 * File system operations interface
 * Mirrors fs-extra methods used in the codebase
 */
export interface IFileSystem {
  // Basic fs operations
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string | Buffer): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<Stats>;
  unlink(path: string): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  
  // fs-extra methods
  ensureDir(path: string): Promise<void>;
  ensureDirSync(path: string): void;
  pathExists(path: string): Promise<boolean>;
  existsSync(path: string): boolean;
  remove(path: string): Promise<void>;
  copy(src: string, dest: string): Promise<void>;
  outputFile(file: string, data: string | Buffer): Promise<void>;
}

/**
 * Child process interface
 * Mirrors Node.js ChildProcess
 */
export interface IChildProcess extends EventEmitter {
  pid?: number;
  killed: boolean;
  kill(signal?: string): boolean;
  send(message: unknown): boolean;
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
}

/**
 * Process management interface
 * Handles process spawning and management
 */
export interface IProcessManager {
  spawn(command: string, args?: string[], options?: SpawnOptions): IChildProcess;
  exec(command: string): Promise<{ stdout: string; stderr: string }>;
}

/**
 * Network management interface
 * Handles network operations like finding free ports
 */
export interface INetworkManager {
  createServer(): IServer;
  findFreePort(): Promise<number>;
}

/**
 * Network server interface
 * Mirrors Node.js net.Server
 */
export interface IServer extends EventEmitter {
  listen(port: number, callback?: () => void): this;
  close(callback?: (err?: Error) => void): this;
  address(): { port: number } | string | null;
  unref(): this;
}

/**
 * Logger interface
 * Standard logging methods used throughout the codebase
 */
export interface ILogger {
  info(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  debug(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
}

/**
 * Proxy manager factory interface
 */
export interface IProxyManagerFactory {
  create(): IProxyManager;
}

/**
 * Environment abstraction interface
 * Provides access to environment variables and current working directory
 */
export interface IEnvironment {
  get(key: string): string | undefined;
  getAll(): Record<string, string | undefined>;
  getCurrentWorkingDirectory(): string;
}

/**
 * Complete set of dependencies for dependency injection
 */
export interface IDependencies {
  fileSystem: IFileSystem;
  processManager: IProcessManager;
  networkManager: INetworkManager;
  logger: ILogger;
  environment: IEnvironment;
}

/**
 * Partial dependencies for gradual migration
 * Allows components to specify only the dependencies they need
 */
export type PartialDependencies = Partial<IDependencies>;

/**
 * Factory interfaces for creating dependencies
 */
export interface ILoggerFactory {
  createLogger(name: string, options?: Record<string, unknown>): ILogger;
}

export interface IChildProcessFactory {
  createChildProcess(): IChildProcess;
}
