/**
 * Command finder implementation using the 'which' npm package
 */
import which from 'which';
import { CommandFinder, CommandNotFoundError } from '../interfaces/command-finder.js';

/**
 * Production implementation of CommandFinder using the 'which' package
 */
export class WhichCommandFinder implements CommandFinder {
  private cache = new Map<string, string>();

  /**
   * @param useCache Whether to cache found command paths (default: true)
   */
  constructor(private useCache: boolean = true) {}

  /**
   * Find the full path to an executable command
   * @param command The command name to find
   * @returns The full path to the executable
   * @throws CommandNotFoundError if the command is not found
   */
  async find(command: string): Promise<string> {
    // Check cache first
    if (this.useCache && this.cache.has(command)) {
      return this.cache.get(command)!;
    }

    try {
      const path = await which(command);
      
      // Cache the result
      if (this.useCache) {
        this.cache.set(command, path);
      }
      
      return path;
    } catch {
      // Convert which's error to our custom error type
      throw new CommandNotFoundError(command);
    }
  }

  /**
   * Clear the cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }
}
