import * as vscode from 'vscode';

export type GitFileStatus =
  | 'untracked'
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'staged';

export interface DiffHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
}

export interface GitChangedFile {
  readonly uri: vscode.Uri;
  readonly relPath: string;
  readonly oldRelPath?: string;
  readonly status: GitFileStatus;
  readonly isStaged: boolean;
  readonly isUntracked: boolean;
  readonly hunks?: readonly DiffHunk[];
}

export interface GitRepoState {
  readonly rootUri: vscode.Uri;
  readonly rootPath: string;
  readonly isGitRepo: boolean;
  readonly branch?: string;
  readonly headCommit?: string;
  readonly isUnbornHead: boolean;
  readonly isDetachedHead: boolean;
  readonly isShallow: boolean;
}

export interface GitStatusResult {
  readonly repoState: GitRepoState;
  readonly changedFiles: readonly GitChangedFile[];
  readonly stagedCount: number;
  readonly unstagedCount: number;
  readonly untrackedCount: number;
}

export interface GitExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface IGitService {
  isGitAvailable(): Promise<boolean>;
  isGitRepository(uri: vscode.Uri): Promise<boolean>;
  getRepositoryState(uri: vscode.Uri): Promise<GitRepoState | undefined>;
  getStatusForRoot(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<GitStatusResult | undefined>;
  getAllStatuses(token?: vscode.CancellationToken): Promise<ReadonlyMap<string, GitStatusResult>>;
  getFileAtHead(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<string | undefined>;
  readonly onDidChangeGitStatus: vscode.Event<ReadonlyMap<string, GitStatusResult>>;
}
