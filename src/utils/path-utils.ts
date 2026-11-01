import * as path from 'path';
import * as vscode from 'vscode';
import { FileFilter } from '../monitoring/file-filter';

export function normalizePath(filePath: string): string {
  return FileFilter.normalizePath(filePath);
}

export function getRelativePath(uri: vscode.Uri, roots: readonly vscode.Uri[]): string {
  const filePath = uri.fsPath;
  for (const root of roots) {
    const rootPath = root.fsPath;
    if (filePath.startsWith(rootPath)) {
      const relative = path.relative(rootPath, filePath);
      return normalizePath(relative);
    }
  }
  return normalizePath(path.basename(filePath));
}

export function isIgnoredPath(filePath: string): boolean {
  return FileFilter.shouldIgnore(filePath);
}
