import * as cp from 'child_process';
import * as vscode from 'vscode';
import { GitExecutionResult } from './types';

export interface GitRunOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxBufferBytes?: number;
  readonly token?: vscode.CancellationToken;
  readonly env?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BUFFER = 5 * 1024 * 1024; // 5 MB

export class GitProcess {
  private static _gitAvailable: boolean | undefined;

  /**
   * Checks whether the git binary is available on the PATH.
   */
  public static async isAvailable(): Promise<boolean> {
    if (this._gitAvailable !== undefined) {
      return this._gitAvailable;
    }

    try {
      const res = await this.exec(['--version'], { timeoutMs: 3000 });
      this._gitAvailable = res.exitCode === 0;
    } catch {
      this._gitAvailable = false;
    }
    return this._gitAvailable;
  }

  /**
   * Resets cached git availability (useful for testing).
   */
  public static resetAvailabilityCache(): void {
    this._gitAvailable = undefined;
  }

  /**
   * Safely executes git with argument arrays.
   * Never invokes a shell.
   */
  public static exec(
    args: readonly string[],
    options: GitRunOptions = {}
  ): Promise<GitExecutionResult> {
    const cwd = options.cwd ?? process.cwd();
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER;

    // Sanitize environment: remove ELECTRON_RUN_AS_NODE to prevent interference
    const sanitizedEnv = { ...process.env, ...options.env };
    delete sanitizedEnv.ELECTRON_RUN_AS_NODE;

    return new Promise<GitExecutionResult>((resolve, reject) => {
      let isCompleted = false;

      const child = cp.execFile(
        'git',
        args,
        {
          cwd,
          timeout,
          maxBuffer,
          env: sanitizedEnv,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          if (isCompleted) {
            return;
          }
          isCompleted = true;

          const outStr = typeof stdout === 'string' ? stdout : '';
          const errStr = typeof stderr === 'string' ? stderr : '';

          if (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code === 'ENOENT') {
              this._gitAvailable = false;
              reject(new Error('Git executable not found in PATH (ENOENT).'));
              return;
            }

            // Normal non-zero exit codes from git are returned rather than throwing
            const exitCode = typeof nodeError.code === 'number' ? nodeError.code : 1;
            resolve({
              stdout: outStr,
              stderr: errStr,
              exitCode,
            });
            return;
          }

          resolve({
            stdout: outStr,
            stderr: errStr,
            exitCode: 0,
          });
        }
      );

      // Handle token cancellation
      if (options.token) {
        const registration = options.token.onCancellationRequested(() => {
          if (!isCompleted) {
            isCompleted = true;
            try {
              child.kill('SIGKILL');
            } catch {
              // child may have already terminated
            }
            resolve({
              stdout: '',
              stderr: 'Operation cancelled',
              exitCode: -1,
            });
          }
          registration.dispose();
        });
      }
    });
  }
}
