import * as path from 'path';
import * as vscode from 'vscode';

export function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/');
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
  const normalized = normalizePath(filePath);
  const segments = normalized.split('/');
  const ignoredSegments = new Set([
    'node_modules',
    '.git',
    '.vscode-test',
    'dist',
    'out',
    'build',
    'target',
    '.turbo',
    '.next',
    '.nuxt',
    'vendor',
  ]);

  return segments.some(seg => ignoredSegments.has(seg));
}

