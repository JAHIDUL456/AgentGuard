import * as vscode from 'vscode';
import { Disposable } from '../../core/disposable';
import { ILogger } from '../../core/logger';

export interface SettlerOptions {
  /** Quiet period in ms with no diagnostic change before settling is considered achieved. Default 150ms */
  readonly quietWindowMs?: number;
  /** Maximum wait cap in ms to prevent stalling. Default 2000ms */
  readonly maxWaitMs?: number;
}

export class DiagnosticSettler extends Disposable {
  private readonly _quietWindowMs: number;
  private readonly _maxWaitMs: number;

  constructor(
    private readonly _logger: ILogger,
    options: SettlerOptions = {}
  ) {
    super();
    this._quietWindowMs = options.quietWindowMs ?? 150;
    this._maxWaitMs = options.maxWaitMs ?? 2000;
  }

  /**
   * Waits for language server diagnostics to settle dynamically.
   * Resolves true if settled within quiet window, or false if timed out by maxWaitMs or cancelled.
   */
  public waitForSettling(
    targetUris?: readonly vscode.Uri[],
    cancellationToken?: vscode.CancellationToken
  ): Promise<boolean> {
    if (cancellationToken?.isCancellationRequested) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>(resolve => {
      let quietTimer: NodeJS.Timeout | undefined;
      let maxTimer: NodeJS.Timeout | undefined;
      let listener: vscode.Disposable | undefined;
      let cancelRegistration: vscode.Disposable | undefined;

      const targetPathSet = targetUris
        ? new Set(targetUris.map(u => u.fsPath))
        : undefined;

      const cleanup = () => {
        if (quietTimer) {
          clearTimeout(quietTimer);
          quietTimer = undefined;
        }
        if (maxTimer) {
          clearTimeout(maxTimer);
          maxTimer = undefined;
        }
        if (listener) {
          listener.dispose();
          listener = undefined;
        }
        if (cancelRegistration) {
          cancelRegistration.dispose();
          cancelRegistration = undefined;
        }
      };

      const onSettled = (success: boolean) => {
        cleanup();
        resolve(success);
      };

      // Cancellation listener
      if (cancellationToken) {
        cancelRegistration = cancellationToken.onCancellationRequested(() => {
          this._logger.debug('Diagnostic settling cancelled via token.');
          onSettled(false);
        });
      }

      const resetQuietTimer = () => {
        if (quietTimer) {
          clearTimeout(quietTimer);
        }
        quietTimer = setTimeout(() => {
          this._logger.debug(
            `Diagnostics settled dynamically after ${this._quietWindowMs}ms quiet window.`
          );
          onSettled(true);
        }, this._quietWindowMs);
      };

      // Maximum wait boundary timer
      maxTimer = setTimeout(() => {
        this._logger.debug(
          `Diagnostic settling hit max wait boundary (${this._maxWaitMs}ms). Proceeding with available diagnostics.`
        );
        onSettled(false);
      }, this._maxWaitMs);

      // Start initial quiet window immediately
      resetQuietTimer();

      // Listen for incoming diagnostic events
      listener = vscode.languages.onDidChangeDiagnostics(event => {
        if (cancellationToken?.isCancellationRequested) {
          onSettled(false);
          return;
        }

        // If specific target URIs were requested, only reset if at least one matches
        if (targetPathSet) {
          const affectsTarget = event.uris.some(uri => targetPathSet.has(uri.fsPath));
          if (!affectsTarget) {
            return;
          }
        }

        this._logger.debug('Diagnostics updated by language provider, resetting quiet timer.');
        resetQuietTimer();
      });
    });
  }
}
