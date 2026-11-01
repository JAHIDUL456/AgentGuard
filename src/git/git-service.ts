import * as vscode from 'vscode';
import { Disposable } from '../core/disposable';
import { ILogger } from '../core/logger';
import { GitRepositoryInfo, IGitService } from './types';

export class GitService extends Disposable implements IGitService {
  constructor(private readonly _logger: ILogger) {
    super();
  }

  public async isGitRepository(uri: vscode.Uri): Promise<boolean> {
    try {
      const gitDirUri = vscode.Uri.joinPath(uri, '.git');
      const stat = await vscode.workspace.fs.stat(gitDirUri);
      return (
        stat.type === vscode.FileType.Directory ||
        stat.type === vscode.FileType.File // Git worktree / submodule has .git as file
      );
    } catch {
      return false;
    }
  }

  public async getRepositoryInfo(
    uri: vscode.Uri
  ): Promise<GitRepositoryInfo | undefined> {
    const isRepo = await this.isGitRepository(uri);
    if (!isRepo) {
      return undefined;
    }
    this._logger.debug(`Found Git repository at ${uri.fsPath}`);
    return {
      rootUri: uri,
      isGitRepo: true,
    };
  }
}

