/**
 * Mock implementation of CommandFinder for testing
 */
import { CommandFinder, CommandNotFoundError } from '../../src/interfaces/command-finder.js';

/**
 * Mock command finder for unit tests
 */
export class MockCommandFinder implements CommandFinder {
  private responses = new Map<string, string | Error>();
  private callHistory: string[] = [];

  /**
   * Set a response for a specific command
   * @param command The command to mock
   * @param response The path to return or an error to throw
   */
  setResponse(command: string, response: string | Error): void {
    this.responses.set(command, response);
  }

  /**
   * Find the full path to an executable command (mocked)
   * @param command The command name to find
   * @returns The mocked path
   * @throws CommandNotFoundError or any configured error
   */
  async find(command: string): Promise<string> {
    this.callHistory.push(command);
    
    const response = this.responses.get(command);
    
    if (!response) {
      throw new CommandNotFoundError(command);
    }
    
    if (response instanceof Error) {
      throw response;
    }
    
    return response;
  }

  /**
   * Clear all configured responses
   */
  clearResponses(): void {
    this.responses.clear();
  }

  /**
   * Get the history of commands that were looked up
   */
  getCallHistory(): string[] {
    return [...this.callHistory];
  }

  /**
   * Clear the call history
   */
  clearHistory(): void {
    this.callHistory = [];
  }

  /**
   * Reset everything (responses and history)
   */
  reset(): void {
    this.clearResponses();
    this.clearHistory();
  }
}
