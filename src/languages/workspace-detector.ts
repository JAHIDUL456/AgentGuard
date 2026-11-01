import * as path from 'path';
import * as vscode from 'vscode';
import { ILogger } from '../core/logger';
import { FileFilter } from '../monitoring/file-filter';
import { LanguageAdapterRegistry } from './adapter-registry';
import {
  DetectedManifest,
  ILanguageAdapter,
  WorkspaceLanguageSummary,
} from './types';

export class WorkspaceLanguageDetector {
  constructor(
    private readonly _registry: LanguageAdapterRegistry,
    private readonly _logger: ILogger
  ) {}

  /**
   * Fast, non-recursive workspace language detection.
   * Checks workspace root manifests and immediate subdirectories (depth 1) for nested projects.
   */
  public async detectWorkspace(
    roots: readonly vscode.Uri[]
  ): Promise<WorkspaceLanguageSummary> {
    const detectedLanguages = new Map<string, ILanguageAdapter>();
    const manifests: DetectedManifest[] = [];

    for (const root of roots) {
      const rootManifests = await this._scanRootManifests(root);
      manifests.push(...rootManifests);

      for (const m of rootManifests) {
        const adapter = this._registry.getAdapterById(m.adapterId);
        if (adapter) {
          detectedLanguages.set(adapter.id, adapter);
        }
      }
    }

    const languages = Array.from(detectedLanguages.values());
    const isMultiLanguage = languages.length > 1;
    const primaryLanguage = languages[0]?.displayName;

    this._logger.debug(
      `Detected ${languages.length} language(s) across ${manifests.length} manifest(s)`
    );

    return {
      detectedLanguages: languages,
      manifests,
      isMultiLanguage,
      primaryLanguage,
    };
  }

  private async _scanRootManifests(
    rootUri: vscode.Uri
  ): Promise<DetectedManifest[]> {
    const found: DetectedManifest[] = [];

    try {
      const entries = await vscode.workspace.fs.readDirectory(rootUri);

      // 1. Check top-level files in root
      for (const [name, type] of entries) {
        if (FileFilter.shouldIgnore(name)) {
          continue;
        }

        if (type === vscode.FileType.File) {
          const matchingAdapters = this._registry.getAdaptersForManifest(name);
          for (const adapter of matchingAdapters) {
            found.push({
              manifestName: name,
              uri: vscode.Uri.joinPath(rootUri, name),
              adapterId: adapter.id,
            });
          }
        }
      }

      // 2. Check depth-1 directories for nested projects (e.g. apps, packages, services)
      for (const [name, type] of entries) {
        if (type !== vscode.FileType.Directory || FileFilter.shouldIgnore(name)) {
          continue;
        }

        const subDirUri = vscode.Uri.joinPath(rootUri, name);
        try {
          const subEntries = await vscode.workspace.fs.readDirectory(subDirUri);
          for (const [subName, subType] of subEntries) {
            if (subType === vscode.FileType.File && !FileFilter.shouldIgnore(subName)) {
              const matchingAdapters = this._registry.getAdaptersForManifest(subName);
              for (const adapter of matchingAdapters) {
                found.push({
                  manifestName: path.join(name, subName),
                  uri: vscode.Uri.joinPath(subDirUri, subName),
                  adapterId: adapter.id,
                });
              }
            }
          }
        } catch {
          // ignore directory read errors
        }
      }
    } catch (err) {
      this._logger.warn(
        `Failed to scan manifests for ${rootUri.fsPath}:`,
        err
      );
    }

    return found;
  }
}
