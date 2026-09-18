export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const ORDER: Record<LogLevel, number> = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };

export interface Logger {
  fatal(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  trace(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

/**
 * Line-oriented JSON logging. Stays dependency-free so the engine can run as a
 * child process of the desktop app and have its output parsed there.
 */
export function createLogger(level: LogLevel, bindings: Record<string, unknown> = {}): Logger {
  const threshold = ORDER[level];
  const emit = (lvl: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] > threshold) return;
    const line = JSON.stringify({
      t: new Date().toISOString(),
      level: lvl,
      msg: message,
      ...bindings,
      ...fields,
    });
    if (ORDER[lvl] <= ORDER.warn) process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    fatal: (m, f) => emit('fatal', m, f),
    error: (m, f) => emit('error', m, f),
    warn: (m, f) => emit('warn', m, f),
    info: (m, f) => emit('info', m, f),
    debug: (m, f) => emit('debug', m, f),
    trace: (m, f) => emit('trace', m, f),
    child: (extra) => createLogger(level, { ...bindings, ...extra }),
  };
}

/** Turns an unknown throwable into something loggable without losing the stack. */
export function errorFields(cause: unknown): Record<string, unknown> {
  if (cause instanceof Error) {
    return { err: cause.message, stack: cause.stack, cause: cause.cause ? String(cause.cause) : undefined };
  }
  return { err: String(cause) };
}
