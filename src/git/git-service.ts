import * as path from 'path';
import * as vscode from 'vscode';
import { Disposable } from '../core/disposable';
import { ILogger } from '../core/logger';
import { GitClient } from './git-client';
import { GitProcess } from './git-process';
import { GitRepoState, GitStatusResult, IGitService } from './types';

export class GitService extends Disposable implements IGitService {
  private readonly _client: GitClient;
  private readonly _statusCache = new Map<string, GitStatusResult>();
  private readonly _statusCacheTimestamps = new Map<string, number>();
  private readonly _repoRoots = new Map<string, string>(); // workspaceUri string -> git repo root path

  private static readonly STATUS_CACHE_TTL_MS = 2000;

  private readonly _onDidChangeGitStatus = this._register(
    new vscode.EventEmitter<ReadonlyMap<string, GitStatusResult>>()
  );
  public readonly onDidChangeGitStatus: vscode.Event<
    ReadonlyMap<string, GitStatusResult>
  > = this._onDidChangeGitStatus.event;

  constructor(private readonly _logger: ILogger) {
    super();
    this._client = new GitClient(this._logger);
  }

  public async isGitAvailable(): Promise<boolean> {
    return this._client.isAvailable();
  }

  public async isGitRepository(uri: vscode.Uri): Promise<boolean> {
    const root = await this._resolveRepoRoot(uri);
    return root !== undefined;
  }

  public async getRepositoryState(
    uri: vscode.Uri
  ): Promise<GitRepoState | undefined> {
    const root = await this._resolveRepoRoot(uri);
    if (!root) {
      return undefined;
    }
    return this._client.getRepoState(root);
  }

  public async getStatusForRoot(
    uri: vscode.Uri,
    token?: vscode.CancellationToken,
    forceRefresh = false
  ): Promise<GitStatusResult | undefined> {
    const key = uri.toString();
    const now = Date.now();
    if (!forceRefresh) {
      const cached = this._statusCache.get(key);
      const cachedTime = this._statusCacheTimestamps.get(key);
      if (cached && cachedTime && (now - cachedTime < GitService.STATUS_CACHE_TTL_MS)) {
        return cached;
      }
    }

    const repoRoot = await this._resolveRepoRoot(uri);
    if (!repoRoot) {
      return undefined;
    }

    try {
      const result = await this._client.getStatus(repoRoot, token);
      this._statusCache.set(key, result);
      this._statusCacheTimestamps.set(key, now);
      return result;
    } catch (err) {
      this._logger.warn(
        `Failed to query Git status for ${uri.fsPath}:`,
        err
      );
      return undefined;
    }
  }

  public async getAllStatuses(
    token?: vscode.CancellationToken
  ): Promise<ReadonlyMap<string, GitStatusResult>> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      await this.getStatusForRoot(folder.uri, token);
    }
    this._onDidChangeGitStatus.fire(this._statusCache);
    return this._statusCache;
  }

  public async getFileAtHead(
    uri: vscode.Uri,
    token?: vscode.CancellationToken
  ): Promise<string | undefined> {
    const repoRoot = await this._resolveRepoRoot(uri);
    if (!repoRoot) {
      return undefined;
    }
    const relPath = path.relative(repoRoot, uri.fsPath).replace(/\\/g, '/');
    try {
      const res = await GitProcess.exec(['show', `HEAD:${relPath}`], {
        cwd: repoRoot,
        timeoutMs: 3000,
        token,
      });
      if (res.exitCode === 0) {
        return res.stdout;
      }
    } catch (err) {
      this._logger.debug(`Could not retrieve git HEAD for ${uri.fsPath}:`, err);
    }
    return undefined;
  }

  public invalidateCache(uri?: vscode.Uri): void {
    if (uri) {
      this._statusCache.delete(uri.toString());
      this._statusCacheTimestamps.delete(uri.toString());
      this._repoRoots.delete(uri.toString());
    } else {
      this._statusCache.clear();
      this._statusCacheTimestamps.clear();
      this._repoRoots.clear();
    }
  }

  private async _resolveRepoRoot(uri: vscode.Uri): Promise<string | undefined> {
    const key = uri.toString();
    const cached = this._repoRoots.get(key);
    if (cached !== undefined) {
      return cached || undefined;
    }

    const detected = await this._client.detectRepositoryRoot(uri.fsPath);
    this._repoRoots.set(key, detected ?? '');
    if (detected) {
      this._logger.debug(`Mapped workspace ${uri.fsPath} to Git root ${detected}`);
    }
    return detected;
  }
}
