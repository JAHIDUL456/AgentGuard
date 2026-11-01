import * as path from 'path';
import * as vscode from 'vscode';
import { DiffHunk, GitChangedFile, GitFileStatus } from './types';

export class GitParser {
  /**
   * Parses NUL-delimited output from `git status --porcelain=v1 -z -uall`.
   * Preserves unusual filenames, Unicode characters, and spaces losslessly.
   */
  public static parsePorcelainV1Z(
    rawOutput: string,
    repoRoot: string
  ): GitChangedFile[] {
    const results: GitChangedFile[] = [];
    if (!rawOutput) {
      return results;
    }

    const tokens = rawOutput.split('\0');
    let i = 0;

    while (i < tokens.length) {
      const entry = tokens[i];
      i++;

      if (!entry || entry.length < 3) {
        continue;
      }

      const x = entry[0]!;
      const y = entry[1]!;
      const relPath = entry.substring(3);

      let oldRelPath: string | undefined;

      // In NUL-delimited mode, renames and copies include the original path as the next token
      if (x === 'R' || y === 'R' || x === 'C' || y === 'C') {
        if (i < tokens.length) {
          oldRelPath = tokens[i];
          i++;
        }
      }

      const isUntracked = x === '?' && y === '?';
      const isStaged = (x !== ' ' && x !== '?') || isUntracked;
      const status = this._determineStatus(x, y, isUntracked);

      const fullPath = path.join(repoRoot, relPath);
      results.push({
        uri: vscode.Uri.file(fullPath),
        relPath,
        oldRelPath,
        status,
        isStaged: isUntracked ? false : isStaged,
        isUntracked,
      });
    }

    return results;
  }

  /**
   * Parses line diff hunks from unified diff output.
   * `@@ -oldStart,oldCount +newStart,newCount @@`
   */
  public static parseUnifiedDiffHunks(
    diffText: string,
    maxHunks: number = 200
  ): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    if (!diffText) {
      return hunks;
    }

    const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
    let match: RegExpExecArray | null;

    while ((match = hunkRegex.exec(diffText)) !== null) {
      if (hunks.length >= maxHunks) {
        break; // Guard against massive diff memory spikes
      }

      const oldStart = parseInt(match[1]!, 10);
      const oldCount = match[2] !== undefined ? parseInt(match[2]!, 10) : 1;
      const newStart = parseInt(match[3]!, 10);
      const newCount = match[4] !== undefined ? parseInt(match[4]!, 10) : 1;

      hunks.push({
        oldStart,
        oldCount,
        newStart,
        newCount,
      });
    }

    return hunks;
  }

  private static _determineStatus(
    x: string,
    y: string,
    isUntracked: boolean
  ): GitFileStatus {
    if (isUntracked) {
      return 'untracked';
    }
    if (x === 'A' || y === 'A') {
      return 'added';
    }
    if (x === 'D' || y === 'D') {
      return 'deleted';
    }
    if (x === 'R' || y === 'R') {
      return 'renamed';
    }
    if (x === 'C' || y === 'C') {
      return 'copied';
    }
    if (x === 'M' || y === 'M') {
      return 'modified';
    }
    return 'modified';
  }
}

