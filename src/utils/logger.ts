/**
 * Logger utility for the Debug MCP Server.
 */
import * as winston from 'winston';
import type { Logger as WinstonLoggerType } from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Logger configuration options.
 */
export interface LoggerOptions {
  /** The log level to use (error, warn, info, debug) */
  level?: string;
  /** Optional file path to log to */
  file?: string;
}

let defaultLogger: WinstonLoggerType | null = null;

/**
 * Create a winston logger with the given namespace.
 * 
 * @param namespace - The logger namespace
 * @param options - Logger configuration options
 * @returns A configured winston logger instance
 */
export function createLogger(namespace: string, options: LoggerOptions = {}): WinstonLoggerType {
  const level = options.level || 'info';
  
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...rest }) => {
          return `${timestamp} [${level}] [${namespace}]: ${message} ${
            Object.keys(rest).length ? JSON.stringify(rest, null, 2) : ''
          }`;
        })
      )
    })
  ];
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRootDefaultLogPath = path.resolve(__dirname, '../../logs/debug-mcp-server.log');
  
  const logFilePath = options.file || projectRootDefaultLogPath;

  try {
    const logDir = path.dirname(logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch (e) {
    console.error(`[Logger Init Error] Failed to ensure log directory for ${logFilePath}:`, e);
  }

  try {
    transports.push(
      new winston.transports.File({
        filename: logFilePath,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      })
    );
  } catch (fileTransportError) {
    console.error(`[Logger Init Error] Failed to create file transport for ${logFilePath}:`, fileTransportError);
  }
  
  const logger = winston.createLogger({
    level,
    transports,
    defaultMeta: { namespace },
    exitOnError: false
  });

  logger.on('error', (error: Error) => {
    console.error('[Winston Logger Internal Error] Failed to write to a transport:', error);
  });

  // If this is the root logger, set it as the default
  if (namespace === 'debug-mcp') {
    defaultLogger = logger;
  }

  return logger;
}

/**
 * Get the default logger instance. If no root logger has been created, a fallback logger is created.
 * @returns The default logger instance.
 */
export function getLogger(): WinstonLoggerType {
  if (!defaultLogger) {
    defaultLogger = createLogger('debug-mcp:default-fallback', { level: 'info' });
    defaultLogger.warn('[Logger] getLogger() called before root logger was initialized. Using fallback logger.');
  }
  return defaultLogger;
}
