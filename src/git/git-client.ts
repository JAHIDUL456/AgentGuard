import * as vscode from 'vscode';
import { ILogger } from '../core/logger';
import { GitParser } from './git-parser';
import { GitProcess } from './git-process';
import { DiffHunk, GitRepoState, GitStatusResult } from './types';

export class GitClient {
  constructor(private readonly _logger: ILogger) {}

  public async isAvailable(): Promise<boolean> {
    return GitProcess.isAvailable();
  }

  public async detectRepositoryRoot(
    dirPath: string
  ): Promise<string | undefined> {
    try {
      const res = await GitProcess.exec(['rev-parse', '--show-toplevel'], {
        cwd: dirPath,
        timeoutMs: 3000,
      });

      if (res.exitCode === 0 && res.stdout.trim().length > 0) {
        return res.stdout.trim();
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  public async getRepoState(
    repoRoot: string,
    token?: vscode.CancellationToken
  ): Promise<GitRepoState> {
    // 1. Check if HEAD is valid (or unborn)
    const headCheck = await GitProcess.exec(['rev-parse', '--verify', 'HEAD'], {
      cwd: repoRoot,
      timeoutMs: 2500,
      token,
    });
    const isUnbornHead = headCheck.exitCode !== 0;
    const headCommit = !isUnbornHead ? headCheck.stdout.trim() : undefined;

    // 2. Query branch name
    const branchRes = await GitProcess.exec(
      ['branch', '--show-current'],
      {
        cwd: repoRoot,
        timeoutMs: 2500,
        token,
      }
    );
    let branch = branchRes.exitCode === 0 ? branchRes.stdout.trim() : undefined;

    // If branch is empty and HEAD is unborn, try symbolic-ref
    if (!branch && isUnbornHead) {
      const symRef = await GitProcess.exec(
        ['symbolic-ref', '--short', 'HEAD'],
        {
          cwd: repoRoot,
          timeoutMs: 2000,
          token,
        }
      );
      if (symRef.exitCode === 0) {
        branch = symRef.stdout.trim();
      }
    }

    // 3. Check detached HEAD
    const isDetachedHead = !isUnbornHead && (!branch || branch.length === 0);

    // 4. Check shallow repository
    const shallowRes = await GitProcess.exec(
      ['rev-parse', '--is-shallow-repository'],
      {
        cwd: repoRoot,
        timeoutMs: 2000,
        token,
      }
    );
    const isShallow = shallowRes.stdout.trim() === 'true';

    return {
      rootUri: vscode.Uri.file(repoRoot),
      rootPath: repoRoot,
      isGitRepo: true,
      branch: branch || (isDetachedHead ? headCommit?.substring(0, 7) : undefined),
      headCommit,
      isUnbornHead,
      isDetachedHead,
      isShallow,
    };
  }

  public async getStatus(
    repoRoot: string,
    token?: vscode.CancellationToken
  ): Promise<GitStatusResult> {
    const repoState = await this.getRepoState(repoRoot, token);

    // Use -z and -uall to capture all files and raw unescaped names
    const statusRes = await GitProcess.exec(
      ['status', '--porcelain=v1', '-z', '-uall'],
      {
        cwd: repoRoot,
        timeoutMs: 6000,
        token,
      }
    );

    if (statusRes.exitCode !== 0) {
      this._logger.warn(
        `git status exited with code ${statusRes.exitCode}: ${statusRes.stderr}`
      );
      return {
        repoState,
        changedFiles: [],
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
      };
    }

    const changedFiles = GitParser.parsePorcelainV1Z(
      statusRes.stdout,
      repoRoot
    );

    let stagedCount = 0;
    let unstagedCount = 0;
    let untrackedCount = 0;

    for (const f of changedFiles) {
      if (f.isUntracked) {
        untrackedCount++;
      } else {
        if (f.isStaged) {
          stagedCount++;
        }
        if (f.status === 'modified' || f.status === 'deleted') {
          unstagedCount++;
        }
      }
    }

    return {
      repoState,
      changedFiles,
      stagedCount,
      unstagedCount,
      untrackedCount,
    };
  }

  public async getFileDiffHunks(
    repoRoot: string,
    relPath: string,
    staged: boolean,
    token?: vscode.CancellationToken
  ): Promise<readonly DiffHunk[]> {
    const args = ['diff', '-U0'];
    if (staged) {
      args.push('--cached');
    }
    args.push('--', relPath);

    const diffRes = await GitProcess.exec(args, {
      cwd: repoRoot,
      timeoutMs: 4000,
      token,
    });

    if (diffRes.exitCode !== 0) {
      return [];
    }

    return GitParser.parseUnifiedDiffHunks(diffRes.stdout);
  }
}

