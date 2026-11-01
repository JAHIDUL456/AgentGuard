import * as vscode from 'vscode';
import { Disposable } from '../core/disposable';
import { ILogger } from '../core/logger';
import { debounce, DebouncedFunction } from '../utils/debounce';
import { isIgnoredPath } from '../utils/path-utils';
import { ChangeKind, FileChangeEvent, IChangeMonitor } from './types';

const DEFAULT_DEBOUNCE_MS = 300;

export class ChangeMonitor extends Disposable implements IChangeMonitor {
  private _enabled = true;
  private readonly _queuedChanges = new Map<string, FileChangeEvent>();
  private readonly _debouncedFlush: DebouncedFunction<[]>;
  private readonly _onDidChangeFiles = this._register(
    new vscode.EventEmitter<readonly FileChangeEvent[]>()
  );

  public readonly onDidChangeFiles: vscode.Event<readonly FileChangeEvent[]> =
    this._onDidChangeFiles.event;

  constructor(
    private readonly _logger: ILogger,
    debounceMs: number = DEFAULT_DEBOUNCE_MS
  ) {
    super();

    this._debouncedFlush = debounce(() => {
      this._flush();
    }, debounceMs);

    this._setupWatchers();
  }

  public setEnabled(enabled: boolean): void {
    if (this._enabled === enabled) {
      return;
    }
    this._enabled = enabled;
    if (!enabled) {
      this._debouncedFlush.cancel();
      this._queuedChanges.clear();
    }
    this._logger.info(`ChangeMonitor ${enabled ? 'enabled' : 'disabled'}`);
  }

  public isEnabled(): boolean {
    return this._enabled;
  }

  public override dispose(): void {
    this._debouncedFlush.cancel();
    this._queuedChanges.clear();
    super.dispose();
  }

  private _setupWatchers(): void {
    // Watch saved documents
    this._register(
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (!this._enabled || doc.uri.scheme !== 'file') {
          return;
        }
        if (isIgnoredPath(doc.uri.fsPath)) {
          return;
        }
        this._enqueueChange(doc.uri, 'modified');
      })
    );

    // Watch general file system events
    const watcher = this._register(
      vscode.workspace.createFileSystemWatcher('**/*')
    );

    this._register(
      watcher.onDidCreate(uri => {
        if (!this._enabled || isIgnoredPath(uri.fsPath)) {
          return;
        }
        this._enqueueChange(uri, 'created');
      })
    );

    this._register(
      watcher.onDidChange(uri => {
        if (!this._enabled || isIgnoredPath(uri.fsPath)) {
          return;
        }
        this._enqueueChange(uri, 'modified');
      })
    );

    this._register(
      watcher.onDidDelete(uri => {
        if (!this._enabled || isIgnoredPath(uri.fsPath)) {
          return;
        }
        this._enqueueChange(uri, 'deleted');
      })
    );
  }

  private _enqueueChange(uri: vscode.Uri, kind: ChangeKind): void {
    const key = uri.toString();
    this._queuedChanges.set(key, {
      uri,
      kind,
      timestamp: Date.now(),
    });
    this._debouncedFlush();
  }

  private _flush(): void {
    if (!this._enabled || this._queuedChanges.size === 0) {
      return;
    }
    const events = Array.from(this._queuedChanges.values());
    this._queuedChanges.clear();
    this._logger.debug(`Batched ${events.length} file change events`);
    this._onDidChangeFiles.fire(events);
  }
}

