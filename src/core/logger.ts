import * as vscode from 'vscode';
import { IDisposable } from './disposable';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface ILogger extends IDisposable {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  setLevel(level: LogLevel): void;
  show(): void;
}

export class OutputChannelLogger implements ILogger {
  private readonly _channel: vscode.OutputChannel;
  private _level: LogLevel;

  constructor(channelName: string, initialLevel: LogLevel = 'info') {
    this._channel = vscode.window.createOutputChannel(channelName);
    this._level = initialLevel;
  }

  public setLevel(level: LogLevel): void {
    this._level = level;
  }

  public debug(message: string, ...args: unknown[]): void {
    this._log('debug', message, args);
  }

  public info(message: string, ...args: unknown[]): void {
    this._log('info', message, args);
  }

  public warn(message: string, ...args: unknown[]): void {
    this._log('warn', message, args);
  }

  public error(message: string, ...args: unknown[]): void {
    this._log('error', message, args);
  }

  public show(): void {
    this._channel.show(true);
  }

  public dispose(): void {
    this._channel.dispose();
  }

  private _log(level: LogLevel, message: string, args: unknown[]): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this._level]) {
      return;
    }
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + args.map(a => this._formatArg(a)).join(' ') : '';
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${formattedArgs}`;
    this._channel.appendLine(line);
  }

  private _formatArg(arg: unknown): string {
    if (arg instanceof Error) {
      return arg.stack ?? arg.message;
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }
}

export class NullLogger implements ILogger {
  public setLevel(_level: LogLevel): void {
    // no-op
  }
  public debug(_message: string, ..._args: unknown[]): void {
    // no-op
  }
  public info(_message: string, ..._args: unknown[]): void {
    // no-op
  }
  public warn(_message: string, ..._args: unknown[]): void {
    // no-op
  }
  public error(_message: string, ..._args: unknown[]): void {
    // no-op
  }
  public show(): void {
    // no-op
  }
  public dispose(): void {
    // no-op
  }
}

