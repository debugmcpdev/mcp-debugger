import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDebugSession, startDebugging, closeDebugSession, debugServer } from '../test-utils/session-helpers';
import path from 'path';
import { fileURLToPath } from 'url';
import { DebugLanguage } from '../../src/session/models';

describe('Python Discovery - Failure Scenario', () => {
  let sessionId: string | undefined;
  let originalPath: string | undefined;
  const scriptPath = path.resolve(fileURLToPath(import.meta.url), '../../../examples/python/fibonacci.py');

  beforeAll(async () => {
    // Save original PATH
    originalPath = process.env.PATH;
    // Start server with minimal PATH so python commands cannot be found
    process.env.PATH = 'C:\\Windows\\System32';
    await debugServer.start();
  });

  afterAll(async () => {
    if (sessionId) {
      await closeDebugSession(sessionId);
      sessionId = undefined;
    }
    await debugServer.stop();
    // Restore original PATH
    if (originalPath !== undefined) {
      process.env.PATH = originalPath;
    }
  });

  it('should error when Python is not found in PATH', async () => {
const session = await createDebugSession({ language: DebugLanguage.PYTHON, name: 'PythonFailureTest' });
    sessionId = session.id;

    const result = await startDebugging(sessionId, scriptPath);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Python not found');
  }, 30000);
});
