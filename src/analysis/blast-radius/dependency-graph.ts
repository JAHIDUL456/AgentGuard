import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ILogger } from '../../core/logger';
import { LanguageAdapterRegistry } from '../../languages/adapter-registry';
import { isIgnoredPath } from '../../utils/path-utils';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import { DependencyLink } from './blast-types';

export class DependencyGraph {
  // Map consumer Uri string -> DependencyLink[]
  private readonly _consumerLinks = new Map<string, DependencyLink[]>();

  constructor(
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _languageRegistry: LanguageAdapterRegistry,
    private readonly _logger: ILogger
  ) {}

  /**
   * Clears the cached graph links.
   */
  public clear(): void {
    this._consumerLinks.clear();
  }

  /**
   * Scans a file and extracts its dependency links pointing to other workspace files.
   */
  public async analyzeFileDependencies(
    fileUri: vscode.Uri,
    content?: string
  ): Promise<readonly DependencyLink[]> {
    if (fileUri.scheme !== 'file' || isIgnoredPath(fileUri.fsPath)) {
      return [];
    }

    const root = this._workspaceManager.getRootForUri(fileUri);
    if (!root) {
      return [];
    }

    let fileContent = content;
    if (fileContent === undefined) {
      try {
        fileContent = await fs.promises.readFile(fileUri.fsPath, 'utf8');
      } catch (err) {
        this._logger.debug(`Could not read file for dependency scan: ${fileUri.fsPath}`, err);
        return [];
      }
    }

    const adapter = this._languageRegistry.getAdapterForUri(fileUri);
    if (!adapter) {
      return [];
    }

    const rawImports = await adapter.extractDependencies(fileUri, fileContent);
    const links: DependencyLink[] = [];

    const lines = fileContent.split('\n');

    for (const rawImport of rawImports) {
      const isDynamic = this._isDynamicImport(rawImport);
      const importedSymbols = this._extractImportedSymbols(rawImport, lines);
      const line = this._findImportLine(rawImport, lines);

      let resolvedUri = this._resolveModuleUri(fileUri, rawImport, root.uri);
      if (!resolvedUri && isDynamic) {
        resolvedUri = fileUri;
      }
      if (resolvedUri) {
        const relativeConsumer = path
          .relative(root.uri.fsPath, fileUri.fsPath)
          .replace(/\\/g, '/');

        links.push({
          consumerUri: fileUri,
          consumerRelativePath: relativeConsumer,
          providerUri: resolvedUri,
          importedSymbols,
          isDynamic,
          rawImport,
          line,
        });
      }
    }

    this._consumerLinks.set(fileUri.fsPath, links);
    return links;
  }

  /**
   * Finds all untouched files in the workspace that depend on the given provider file.
   */
  public async findDependents(
    providerUri: vscode.Uri,
    workspaceFiles?: readonly vscode.Uri[]
  ): Promise<readonly DependencyLink[]> {
    const dependentLinks: DependencyLink[] = [];
    const providerNormalized = path.normalize(providerUri.fsPath).toLowerCase();

    // If we have workspace files to check, ensure they are indexed
    if (workspaceFiles && workspaceFiles.length > 0) {
      for (const fileUri of workspaceFiles) {
        if (fileUri.fsPath === providerUri.fsPath) {
          continue; // skip the changed provider itself
        }
        if (!this._consumerLinks.has(fileUri.fsPath)) {
          await this.analyzeFileDependencies(fileUri);
        }
      }
    }

    // Now query the cached links
    for (const [consumerPath, links] of this._consumerLinks) {
      if (path.normalize(consumerPath).toLowerCase() === providerNormalized) {
        continue;
      }
      for (const link of links) {
        if (path.normalize(link.providerUri.fsPath).toLowerCase() === providerNormalized) {
          dependentLinks.push(link);
        }
      }
    }

    return dependentLinks;
  }

  /**
   * Resolves a raw import string to a concrete workspace file URI if possible.
   */
  private _resolveModuleUri(
    consumerUri: vscode.Uri,
    rawImport: string,
    workspaceRootUri: vscode.Uri
  ): vscode.Uri | undefined {
    const consumerDir = path.dirname(consumerUri.fsPath);

    // 1. Relative imports: './foo', '../foo/bar'
    if (rawImport.startsWith('.')) {
      const candidateBase = path.resolve(consumerDir, rawImport);
      const resolved = this._probeExtensions(candidateBase);
      if (resolved) {
        return vscode.Uri.file(resolved);
      }
    }

    // 2. C/C++ quoted includes: "header.h", "include/header.h"
    const candidateInConsumerDir = path.resolve(consumerDir, rawImport);
    if (fs.existsSync(candidateInConsumerDir) && fs.statSync(candidateInConsumerDir).isFile()) {
      return vscode.Uri.file(candidateInConsumerDir);
    }

    // 3. Root-relative or package-relative in workspace
    const candidateInRoot = path.resolve(workspaceRootUri.fsPath, rawImport);
    const resolvedRoot = this._probeExtensions(candidateInRoot);
    if (resolvedRoot) {
      return vscode.Uri.file(resolvedRoot);
    }

    // Check src/ directory if common convention
    const candidateSrc = path.resolve(workspaceRootUri.fsPath, 'src', rawImport);
    const resolvedSrc = this._probeExtensions(candidateSrc);
    if (resolvedSrc) {
      return vscode.Uri.file(resolvedSrc);
    }

    return undefined;
  }

  private _probeExtensions(basePath: string): string | undefined {
    // Exact path
    if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
      return basePath;
    }

    // Extensions
    const extensions = [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.py',
      '.go',
      '.rs',
      '.java',
      '.cs',
      '.php',
      '.dart',
      '.c',
      '.h',
      '.cpp',
      '.hpp',
    ];

    for (const ext of extensions) {
      const candidate = `${basePath}${ext}`;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }

    // Index files: /index.ts, /index.js, /mod.rs, etc.
    if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const indexCand = path.join(basePath, `index${ext}`);
        if (fs.existsSync(indexCand) && fs.statSync(indexCand).isFile()) {
          return indexCand;
        }
      }
      const modRs = path.join(basePath, 'mod.rs');
      if (fs.existsSync(modRs) && fs.statSync(modRs).isFile()) {
        return modRs;
      }
    }

    return undefined;
  }

  private _isDynamicImport(rawImport: string): boolean {
    return (
      rawImport.includes('${') ||
      rawImport.includes('+') ||
      rawImport.includes('require(') ||
      rawImport.includes('import(')
    );
  }

  private _extractImportedSymbols(rawImport: string, lines: readonly string[]): string[] {
    const symbols: string[] = [];

    // Find the import statement in lines
    for (const line of lines) {
      if (!line.includes(rawImport)) {
        continue;
      }

      // Check for ES import: import { a, b as c } from '...'
      const namedMatch = line.match(/import\s*\{([^}]+)\}\s*from/);
      if (namedMatch && namedMatch[1]) {
        const parts = namedMatch[1].split(',');
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) {
            continue;
          }
          const asMatch = trimmed.match(/^([a-zA-Z0-9_$]+)(?:\s+as\s+[a-zA-Z0-9_$]+)?$/);
          if (asMatch && asMatch[1]) {
            symbols.push(asMatch[1]);
          }
        }
        return symbols;
      }

      // Check for Python: from foo import a, b, c
      const pyMatch = line.match(/from\s+[\w.]+\s+import\s+([^\n#]+)/);
      if (pyMatch && pyMatch[1]) {
        const parts = pyMatch[1].split(',');
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed && trimmed !== '*') {
            const asMatch = trimmed.match(/^([a-zA-Z0-9_]+)/);
            if (asMatch && asMatch[1]) {
              symbols.push(asMatch[1]);
            }
          }
        }
        return symbols;
      }

      // Default or wildcard import
      if (line.includes('* as ') || line.includes('import *')) {
        symbols.push('*');
        return symbols;
      }
    }

    return symbols;
  }

  private _findImportLine(rawImport: string, lines: readonly string[]): number {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line && line.includes(rawImport)) {
        return i;
      }
    }
    return 0;
  }
}
