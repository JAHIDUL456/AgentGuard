import * as path from 'path';
import * as vscode from 'vscode';
import { Disposable, IDisposable, toDisposable } from '../core/disposable';
import { ILogger } from '../core/logger';
import { CAdapter } from './adapters/c-adapter';
import { CppAdapter } from './adapters/cpp-adapter';
import { CSharpAdapter } from './adapters/csharp-adapter';
import { DartAdapter } from './adapters/dart-adapter';
import { GoAdapter } from './adapters/go-adapter';
import { JavaAdapter } from './adapters/java-adapter';
import { JavaScriptAdapter } from './adapters/javascript-adapter';
import { PhpAdapter } from './adapters/php-adapter';
import { PythonAdapter } from './adapters/python-adapter';
import { RustAdapter } from './adapters/rust-adapter';
import { TypeScriptAdapter } from './adapters/typescript-adapter';
import {
  ILanguageAdapter,
  LanguageDiagnostic,
  StructuralAnalysisResult,
} from './types';

export class LanguageAdapterRegistry extends Disposable {
  private readonly _adapters = new Map<string, ILanguageAdapter>();
  private readonly _extensionIndex = new Map<string, ILanguageAdapter>();
  private readonly _languageIdIndex = new Map<string, ILanguageAdapter>();

  constructor(private readonly _logger: ILogger) {
    super();
  }

  /**
   * Registers all 11 built-in language adapters.
   */
  public registerBuiltinAdapters(): void {
    const builtin: ILanguageAdapter[] = [
      new TypeScriptAdapter(this._logger),
      new JavaScriptAdapter(this._logger),
      new PythonAdapter(this._logger),
      new GoAdapter(this._logger),
      new RustAdapter(this._logger),
      new JavaAdapter(this._logger),
      new CSharpAdapter(this._logger),
      new PhpAdapter(this._logger),
      new DartAdapter(this._logger),
      new CAdapter(this._logger),
      new CppAdapter(this._logger),
    ];

    for (const adapter of builtin) {
      this.registerAdapter(adapter);
    }

    this._logger.info(
      `Registered ${builtin.length} built-in language adapters.`
    );
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

    for (const langId of adapter.languageIds) {
      this._languageIdIndex.set(langId.toLowerCase(), adapter);
    }

    this._logger.debug(
      `Registered language adapter: ${adapter.displayName} [Level ${adapter.capabilityLevel}] (${adapter.fileExtensions.join(', ')})`
    );

    return toDisposable(() => {
      this._adapters.delete(adapter.id);
      for (const ext of adapter.fileExtensions) {
        const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
        if (this._extensionIndex.get(normalizedExt) === adapter) {
          this._extensionIndex.delete(normalizedExt);
        }
      }
      for (const langId of adapter.languageIds) {
        if (this._languageIdIndex.get(langId.toLowerCase()) === adapter) {
          this._languageIdIndex.delete(langId.toLowerCase());
        }
      }
      this._logger.debug(`Unregistered language adapter: ${adapter.id}`);
    });
  }

  public getAdapterById(id: string): ILanguageAdapter | undefined {
    return this._adapters.get(id);
  }

  public getAdapterByLanguageId(languageId: string): ILanguageAdapter | undefined {
    return this._languageIdIndex.get(languageId.toLowerCase());
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

  public getAdaptersForManifest(manifestFileName: string): readonly ILanguageAdapter[] {
    const matching: ILanguageAdapter[] = [];
    for (const adapter of this._adapters.values()) {
      if (adapter.matchesManifest(manifestFileName)) {
        matching.push(adapter);
      }
    }
    return matching;
  }

  public getAdapters(): readonly ILanguageAdapter[] {
    return Array.from(this._adapters.values());
  }

  /**
   * Safe fault-isolated structural parse helper.
   */
  public async parseStructure(
    uri: vscode.Uri,
    content: string
  ): Promise<StructuralAnalysisResult | undefined> {
    const adapter = this.getAdapterForUri(uri);
    if (!adapter) {
      return undefined;
    }
    return adapter.parseStructure(uri, content);
  }

  /**
   * Safe fault-isolated diagnostics query helper.
   */
  public async getDiagnostics(
    uri: vscode.Uri
  ): Promise<readonly LanguageDiagnostic[]> {
    const adapter = this.getAdapterForUri(uri);
    if (!adapter) {
      return [];
    }
    return adapter.getDiagnostics(uri);
  }

  public override dispose(): void {
    this._adapters.clear();
    this._extensionIndex.clear();
    this._languageIdIndex.clear();
    super.dispose();
  }
}
