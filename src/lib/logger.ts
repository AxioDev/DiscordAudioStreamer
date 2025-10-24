import util from 'node:util';
import winston from 'winston';

const WINSTON_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'] as const;

type WinstonLevel = (typeof WINSTON_LEVELS)[number];

export type LogLevel = WinstonLevel | 'silent';

export interface LoggerServiceOptions {
  level?: string;
  defaultMeta?: winston.LoggerOptions['defaultMeta'];
}

const DEFAULT_LOG_LEVEL: WinstonLevel = 'info';

function normalizeLevel(level: string | undefined): LogLevel {
  if (!level) {
    return DEFAULT_LOG_LEVEL;
  }

  const normalized = level.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_LOG_LEVEL;
  }

  if (normalized === 'silent') {
    return 'silent';
  }

  return WINSTON_LEVELS.includes(normalized as WinstonLevel)
    ? (normalized as WinstonLevel)
    : DEFAULT_LOG_LEVEL;
}

function formatMeta(meta: Record<string, unknown>): string {
  if (Object.keys(meta).length === 0) {
    return '';
  }

  return ` ${util.inspect(meta, { depth: 4, breakLength: 80, colors: false })}`;
}

export class LoggerService {
  private readonly logger: winston.Logger;

  constructor(options: LoggerServiceOptions = {}) {
    const level = normalizeLevel(options.level);
    const effectiveLevel: WinstonLevel = level === 'silent' ? DEFAULT_LOG_LEVEL : level;
    const transports: winston.transport[] = [
      new winston.transports.Console({
        handleExceptions: true,
        handleRejections: true,
        stderrLevels: ['error', 'warn'],
      }),
    ];

    const consoleFormat = winston.format.printf((info) => {
      const {
        timestamp,
        level: infoLevel,
        message,
        stack,
        context,
      } = info as winston.Logform.TransformableInfo & {
        context?: string;
        stack?: string;
        metadata?: Record<string, unknown>;
      };
      const meta = (info as { metadata?: Record<string, unknown> }).metadata ?? {};
      const metaString = formatMeta(meta);
      const contextLabel = context ? `[${context}] ` : '';
      if (stack) {
        return `${timestamp as string} ${infoLevel as string}: ${contextLabel}${stack}${metaString}`;
      }
      return `${timestamp as string} ${infoLevel as string}: ${contextLabel}${message as string}${metaString}`;
    });

    this.logger = winston.createLogger({
      level: effectiveLevel,
      levels: winston.config.npm.levels,
      defaultMeta: options.defaultMeta,
      transports,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label', 'context'] }),
        consoleFormat,
      ),
    });
    this.logger.silent = level === 'silent';
  }

  public getLogger(): winston.Logger {
    return this.logger;
  }

  public setLevel(level: string): void {
    const normalized = normalizeLevel(level);
    this.logger.level = (normalized === 'silent' ? DEFAULT_LOG_LEVEL : normalized) as WinstonLevel;
    this.logger.silent = normalized === 'silent';
  }

  public getLevel(): LogLevel {
    return this.logger.silent ? 'silent' : (this.logger.level as LogLevel);
  }

  public forContext(context: string, defaultMeta: Record<string, unknown> = {}): winston.Logger {
    return this.logger.child({ context, ...defaultMeta });
  }

  public bindToConsole(target: Console = console): void {
    const methods: Array<{ method: keyof Console; level: LogLevel; includeStack?: boolean }> = [
      { method: 'debug', level: 'debug' },
      { method: 'info', level: 'info' },
      { method: 'log', level: 'info' },
      { method: 'warn', level: 'warn' },
      { method: 'error', level: 'error' },
      { method: 'trace', level: 'debug', includeStack: true },
    ];

    for (const descriptor of methods) {
      const bound = this.createConsoleProxy(descriptor.level, descriptor.includeStack ?? false);
      // eslint-disable-next-line no-param-reassign
      (target as unknown as Record<string, unknown>)[descriptor.method as string] = bound;
    }
  }

  public close(): void {
    this.logger.close();
  }

  private createConsoleProxy(level: LogLevel, includeStack: boolean): (...args: unknown[]) => void {
    return (...args: unknown[]): void => {
      if (includeStack) {
        const formatted = this.formatArgs(args);
        const trace = new Error(formatted);
        this.logger.log({
          level: (level === 'silent' ? DEFAULT_LOG_LEVEL : level) as WinstonLevel,
          message: formatted,
          stack: trace.stack,
        });
        return;
      }

      if (args.length === 1 && args[0] instanceof Error) {
        const error = args[0];
        this.logger.log({
          level: (level === 'silent' ? DEFAULT_LOG_LEVEL : level) as WinstonLevel,
          message: error.message,
          stack: error.stack,
          error,
        });
        return;
      }

      const message = this.formatArgs(args);
      this.logger.log({
        level: (level === 'silent' ? DEFAULT_LOG_LEVEL : level) as WinstonLevel,
        message,
      });
    };
  }

  private formatArgs(args: unknown[]): string {
    if (args.length === 0) {
      return '';
    }
    return util.formatWithOptions({ colors: false }, ...(args as [unknown, ...unknown[]]));
  }
}

export default LoggerService;
