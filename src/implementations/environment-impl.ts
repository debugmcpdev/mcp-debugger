/**
 * Environment implementation that wraps Node.js process.env and process.cwd()
 */

import { IEnvironment } from '../interfaces/external-dependencies.js';

/**
 * Production implementation of IEnvironment
 * Provides access to real process environment variables and working directory
 */
export class ProcessEnvironment implements IEnvironment {
  private readonly envSnapshot: Record<string, string | undefined>;

  constructor() {
    // Create an immutable snapshot of environment variables at construction time
    // This prevents mid-execution environment changes from affecting behavior
    this.envSnapshot = { ...process.env };
  }

  /**
   * Get a specific environment variable
   */
  get(key: string): string | undefined {
    return this.envSnapshot[key];
  }

  /**
   * Get all environment variables
   */
  getAll(): Record<string, string | undefined> {
    // Return a copy to prevent external modifications
    return { ...this.envSnapshot };
  }

  /**
   * Get the current working directory
   */
  getCurrentWorkingDirectory(): string {
    return process.cwd();
  }
}
