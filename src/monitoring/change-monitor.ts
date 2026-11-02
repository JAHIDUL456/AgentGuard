import * as vscode from 'vscode';
import { Disposable } from '../core/disposable';
import { ILogger } from '../core/logger';
import { ChangeProcessor, ProcessorOptions } from './change-processor';
import { FileFilter } from './file-filter';
import {
  ChangeBatch,
  ChangeKind,
  EventSource,
  FileChangeEvent,
  IChangeMonitor,
} from './types';

export class ChangeMonitor extends Disposable implements IChangeMonitor {
  private _enabled = true;
  private readonly _processor: ChangeProcessor;

  private readonly _onDidChangeFiles = this._register(
    new vscode.EventEmitter<readonly FileChangeEvent[]>()
  );
  public readonly onDidChangeFiles: vscode.Event<readonly FileChangeEvent[]> =
    this._onDidChangeFiles.event;

  public readonly onDidBatchReady: vscode.Event<ChangeBatch>;

  constructor(
    private readonly _logger: ILogger,
    options: ProcessorOptions = {}
  ) {
    super();

    this._processor = this._register(new ChangeProcessor(this._logger, options));
    this.onDidBatchReady = this._processor.onDidBatchReady;

    // Bridge batch events to onDidChangeFiles for backwards compatibility
    this._register(
      this._processor.onDidBatchReady(batch => {
        this._onDidChangeFiles.fire(batch.events);
      })
    );

    this._setupWatchers();
  }

  public setEnabled(enabled: boolean): void {
    if (this._enabled === enabled) {
      return;
    }
    this._enabled = enabled;
    if (!enabled) {
      this._processor.clear();
    }
    this._logger.info(`ChangeMonitor ${enabled ? 'enabled' : 'disabled'}`);
  }

  public isEnabled(): boolean {
    return this._enabled;
  }

  public clearQueue(): void {
    this._processor.clear();
  }

  public getPendingCount(): number {
    return this._processor.pendingCount;
  }

  public createJobToken(): vscode.CancellationTokenSource {
    return this._processor.createJobToken();
  }

  public cancelActiveJob(): void {
    this._processor.cancelActiveJob();
  }

  public flush(): ChangeBatch | undefined {
    return this._processor.flush();
  }

  private _setupWatchers(): void {
    // 1. Text document in-memory modifications (human or copilot typing)
    this._register(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (!this._enabled || event.document.uri.scheme !== 'file') {
          return;
        }
        if (event.contentChanges.length === 0) {
          return;
        }
        this._handleCandidate(
          event.document.uri,
          'modified',
          'document',
          undefined,
          event.document.version,
          event.contentChanges
        );
      })
    );

    // 2. Opened documents
    if (typeof vscode.workspace.onDidOpenTextDocument === 'function') {
      this._register(
        vscode.workspace.onDidOpenTextDocument(doc => {
          if (!this._enabled || doc.uri.scheme !== 'file') {
            return;
          }
          this._handleCandidate(doc.uri, 'modified', 'document', undefined, doc.version);
        })
      );
    }

    // 3. Saved documents
    this._register(
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (!this._enabled || doc.uri.scheme !== 'file') {
          return;
        }
        this._handleCandidate(doc.uri, 'modified', 'save', undefined, doc.version);
      })
    );

    // 3. File rename operations
    if (typeof vscode.workspace.onDidRenameFiles === 'function') {
      this._register(
        vscode.workspace.onDidRenameFiles(event => {
          if (!this._enabled) {
            return;
          }
          for (const file of event.files) {
            if (file.newUri.scheme === 'file') {
              this._handleCandidate(
                file.newUri,
                'renamed',
                'rename',
                file.oldUri
              );
            }
          }
        })
      );
    }

    // 4. File creation operations (via explorer)
    if (typeof vscode.workspace.onDidCreateFiles === 'function') {
      this._register(
        vscode.workspace.onDidCreateFiles(event => {
          if (!this._enabled) {
            return;
          }
          for (const uri of event.files) {
            if (uri.scheme === 'file') {
              this._handleCandidate(uri, 'created', 'workspace');
            }
          }
        })
      );
    }

    // 5. File deletion operations (via explorer)
    if (typeof vscode.workspace.onDidDeleteFiles === 'function') {
      this._register(
        vscode.workspace.onDidDeleteFiles(event => {
          if (!this._enabled) {
            return;
          }
          for (const uri of event.files) {
            if (uri.scheme === 'file') {
              this._handleCandidate(uri, 'deleted', 'workspace');
            }
          }
        })
      );
    }

    // 6. External file system modifications (AI coding tools, terminal scripts, git checkout)
    const watcher = this._register(
      vscode.workspace.createFileSystemWatcher('**/*')
    );

    this._register(
      watcher.onDidCreate(uri => {
        if (!this._enabled || uri.scheme !== 'file') {
          return;
        }
        this._handleCandidate(uri, 'created', 'watcher');
      })
    );

    this._register(
      watcher.onDidChange(uri => {
        if (!this._enabled || uri.scheme !== 'file') {
          return;
        }
        this._handleCandidate(uri, 'modified', 'watcher');
      })
    );

    this._register(
      watcher.onDidDelete(uri => {
        if (!this._enabled || uri.scheme !== 'file') {
          return;
        }
        this._handleCandidate(uri, 'deleted', 'watcher');
      })
    );

    // 7. Relevant language-service diagnostic updates (excluding AgentGuard's own diagnostics)
    if (typeof vscode.languages.onDidChangeDiagnostics === 'function') {
      this._register(
        vscode.languages.onDidChangeDiagnostics(event => {
          if (!this._enabled) {
            return;
          }
          for (const uri of event.uris) {
            if (uri.scheme !== 'file') {
              continue;
            }
            // Check if updated diagnostics only contain AgentGuard's own diagnostics to avoid loops
            const diags = vscode.languages.getDiagnostics(uri);
            const hasExternalDiags = diags.some(
              d => !d.source || d.source.toLowerCase() !== 'agentguard'
            );
            if (hasExternalDiags || diags.length === 0) {
              this._handleCandidate(uri, 'modified', 'diagnostics');
            }
          }
        })
      );
    }
  }

  private _handleCandidate(
    uri: vscode.Uri,
    kind: ChangeKind,
    source: EventSource,
    oldUri?: vscode.Uri,
    documentVersion?: number,
    contentChanges?: readonly vscode.TextDocumentContentChangeEvent[]
  ): void {
    if (FileFilter.shouldIgnore(uri.fsPath)) {
      return;
    }

    if (oldUri && FileFilter.shouldIgnore(oldUri.fsPath)) {
      oldUri = undefined;
    }

    this._processor.enqueue({
      uri,
      kind,
      timestamp: Date.now(),
      source,
      oldUri,
      documentVersion,
      contentChanges,
    });
  }
}
