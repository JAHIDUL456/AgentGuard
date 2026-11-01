import * as vscode from 'vscode';

export interface WorkspaceRoot {
  readonly id: string;
  readonly name: string;
  readonly uri: vscode.Uri;
  readonly fsPath: string;
  readonly index: number;
}

export interface IWorkspaceManager {
  getRoots(): readonly WorkspaceRoot[];
  getRootForUri(uri: vscode.Uri): WorkspaceRoot | undefined;
  hasWorkspace(): boolean;
  readonly onDidChangeRoots: vscode.Event<readonly WorkspaceRoot[]>;
}

