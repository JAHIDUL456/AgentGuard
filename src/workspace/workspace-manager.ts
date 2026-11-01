import * as vscode from 'vscode';
import { Disposable } from '../core/disposable';
import { ILogger } from '../core/logger';
import { IWorkspaceManager, WorkspaceRoot } from './types';

export class WorkspaceManager extends Disposable implements IWorkspaceManager {
  private _roots: WorkspaceRoot[] = [];
  private readonly _onDidChangeRoots = this._register(
    new vscode.EventEmitter<readonly WorkspaceRoot[]>()
  );

  public readonly onDidChangeRoots: vscode.Event<readonly WorkspaceRoot[]> =
    this._onDidChangeRoots.event;

  constructor(private readonly _logger: ILogger) {
    super();
    this._updateRoots(vscode.workspace.workspaceFolders ?? []);
    this._register(
      vscode.workspace.onDidChangeWorkspaceFolders(event => {
        this._handleWorkspaceFoldersChanged(event);
      })
    );
  }

  public getRoots(): readonly WorkspaceRoot[] {
    return this._roots;
  }

  public hasWorkspace(): boolean {
    return this._roots.length > 0;
  }

  public getRootForUri(uri: vscode.Uri): WorkspaceRoot | undefined {
    const targetPath = uri.fsPath;
    // Find the longest matching root path to support nested workspace folders
    let matched: WorkspaceRoot | undefined;
    for (const root of this._roots) {
      if (
        targetPath.startsWith(root.fsPath) &&
        (!matched || root.fsPath.length > matched.fsPath.length)
      ) {
        matched = root;
      }
    }
    return matched;
  }

  private _handleWorkspaceFoldersChanged(
    event: vscode.WorkspaceFoldersChangeEvent
  ): void {
    this._logger.info(
      `Workspace folders changed: +${event.added.length} added, -${event.removed.length} removed`
    );
    this._updateRoots(vscode.workspace.workspaceFolders ?? []);
    this._onDidChangeRoots.fire(this._roots);
  }

  private _updateRoots(folders: readonly vscode.WorkspaceFolder[]): void {
    this._roots = folders.map(f => ({
      id: f.uri.toString(),
      name: f.name,
      uri: f.uri,
      fsPath: f.uri.fsPath,
      index: f.index,
    }));
    this._logger.debug(`Active workspace roots: ${this._roots.length}`);
  }
}

