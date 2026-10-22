export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

function line(level: string, msg: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
}

export const consoleLogger: Logger = {
  info: (msg, extra) => console.log(line('info', msg, extra)),
  warn: (msg, extra) => console.warn(line('warn', msg, extra)),
  error: (msg, extra) => console.error(line('error', msg, extra)),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
