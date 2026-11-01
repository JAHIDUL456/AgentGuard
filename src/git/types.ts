import * as vscode from 'vscode';

export interface GitRepositoryInfo {
  readonly rootUri: vscode.Uri;
  readonly isGitRepo: boolean;
  readonly headCommit?: string;
}

export interface IGitService {
  isGitRepository(uri: vscode.Uri): Promise<boolean>;
  getRepositoryInfo(uri: vscode.Uri): Promise<GitRepositoryInfo | undefined>;
}

