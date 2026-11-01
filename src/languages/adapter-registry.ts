import * as path from 'path';
import * as vscode from 'vscode';
import { Disposable, IDisposable, toDisposable } from '../core/disposable';
import { ILogger } from '../core/logger';
import { ILanguageAdapter } from './types';

export class LanguageAdapterRegistry extends Disposable {
  private readonly _adapters = new Map<string, ILanguageAdapter>();
  private readonly _extensionIndex = new Map<string, ILanguageAdapter>();

  constructor(private readonly _logger: ILogger) {
    super();
  }

  public registerAdapter(adapter: ILanguageAdapter): IDisposable {
    if (this._adapters.has(adapter.id)) {
      throw new Error(`Language adapter '${adapter.id}' is already registered.`);
    }

    this._adapters.set(adapter.id, adapter);
    for (const ext of adapter.fileExtensions) {
      const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
      this._extensionIndex.set(normalizedExt, adapter);
    }

    this._logger.debug(
      `Registered language adapter: ${adapter.displayName} (${adapter.fileExtensions.join(', ')})`
    );

    return toDisposable(() => {
      this._adapters.delete(adapter.id);
      for (const ext of adapter.fileExtensions) {
        const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
        if (this._extensionIndex.get(normalizedExt) === adapter) {
          this._extensionIndex.delete(normalizedExt);
        }
      }
      this._logger.debug(`Unregistered language adapter: ${adapter.id}`);
    });
  }

  public getAdapterForUri(uri: vscode.Uri): ILanguageAdapter | undefined {
    const ext = path.extname(uri.fsPath).toLowerCase();
    const indexed = this._extensionIndex.get(ext);
    if (indexed && indexed.supports(uri)) {
      return indexed;
    }
    for (const adapter of this._adapters.values()) {
      if (adapter.supports(uri)) {
        return adapter;
      }
    }
    return undefined;
  }

  public getAdapters(): readonly ILanguageAdapter[] {
    return Array.from(this._adapters.values());
  }

  public override dispose(): void {
    this._adapters.clear();
    this._extensionIndex.clear();
    super.dispose();
  }
}

