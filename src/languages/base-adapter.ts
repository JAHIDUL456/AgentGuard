import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { ILogger } from '../core/logger';
import {
  CapabilityLevel,
  ILanguageAdapter,
  LanguageCapability,
  LanguageDiagnostic,
  StructuralAnalysisResult,
  ToolingInfo,
} from './types';

export abstract class BaseLanguageAdapter implements ILanguageAdapter {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly fileExtensions: readonly string[];
  abstract readonly languageIds: readonly string[];
  abstract readonly projectManifests: readonly string[];
  abstract readonly capabilityLevel: CapabilityLevel;
  abstract readonly capabilities: readonly LanguageCapability[];
  abstract readonly knownLimitations: readonly string[];
  readonly tooling?: ToolingInfo;

  constructor(protected readonly _logger: ILogger) {}

  public supports(uri: vscode.Uri): boolean {
    const ext = path.extname(uri.fsPath).toLowerCase();
    return this.fileExtensions.some(e => e.toLowerCase() === ext);
  }

  public supportsLanguageId(languageId: string): boolean {
    return this.languageIds.includes(languageId.toLowerCase());
  }

  public matchesManifest(manifestFileName: string): boolean {
    const base = path.basename(manifestFileName).toLowerCase();
    return this.projectManifests.some(m => {
      const lowerM = m.toLowerCase();
      if (lowerM.startsWith('*.')) {
        return base.endsWith(lowerM.substring(1));
      }
      return base === lowerM;
    });
  }

  /**
   * Safe fault-isolated structural analysis.
   * Catches any internal parser error so one malformed file or parser defect
   * never crashes other adapters or the extension.
   */
  public async parseStructure(
    uri: vscode.Uri,
    content: string
  ): Promise<StructuralAnalysisResult> {
    try {
      return await this._doParseStructure(uri, content);
    } catch (err) {
      this._logger.warn(
        `[Adapter:${this.id}] Structural analysis failed on ${uri.fsPath} (isolated):`,
        err
      );
      return {
        nodes: [],
        imports: [],
        syntaxErrors: [
          {
            message: `Parser error in ${this.displayName} adapter: ${err instanceof Error ? err.message : String(err)}`,
            line: 0,
            character: 0,
            severity: 'warning',
            source: this.id,
          },
        ],
      };
    }
  }

  /**
   * Safe fault-isolated dependency extraction.
   */
  public async extractDependencies(
    uri: vscode.Uri,
    content: string
  ): Promise<readonly string[]> {
    try {
      return await this._doExtractDependencies(uri, content);
    } catch (err) {
      this._logger.warn(
        `[Adapter:${this.id}] Dependency extraction failed on ${uri.fsPath} (isolated):`,
        err
      );
      return [];
    }
  }

  /**
   * Safe diagnostics retrieval integrating VS Code active language servers.
   */
  public async getDiagnostics(
    uri: vscode.Uri
  ): Promise<readonly LanguageDiagnostic[]> {
    try {
      const results: LanguageDiagnostic[] = [];

      // Query active language server diagnostics from VS Code
      if (vscode.languages && typeof vscode.languages.getDiagnostics === 'function') {
        const rawDiags = vscode.languages.getDiagnostics(uri);
        for (const diag of rawDiags) {
          results.push({
            message: diag.message,
            line: diag.range.start.line,
            character: diag.range.start.character,
            severity:
              diag.severity === vscode.DiagnosticSeverity.Error
                ? 'error'
                : diag.severity === vscode.DiagnosticSeverity.Warning
                  ? 'warning'
                  : 'info',
            source: diag.source || this.id,
          });
        }
      }

      const specificDiags = await this._doGetCustomDiagnostics(uri);
      results.push(...specificDiags);

      return results;
    } catch (err) {
      this._logger.warn(
        `[Adapter:${this.id}] Diagnostics query failed for ${uri.fsPath} (isolated):`,
        err
      );
      return [];
    }
  }

  protected abstract _doParseStructure(
    uri: vscode.Uri,
    content: string
  ): Promise<StructuralAnalysisResult>;

  protected abstract _doExtractDependencies(
    uri: vscode.Uri,
    content: string
  ): Promise<readonly string[]>;

  protected async _doGetCustomDiagnostics(
    _uri: vscode.Uri
  ): Promise<readonly LanguageDiagnostic[]> {
    return [];
  }

  /**
   * Helper to verify if an external CLI command is installed and executable.
   */
  protected static async checkCommand(
    command: string,
    args: readonly string[] = ['--version']
  ): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const sanitizedEnv = { ...process.env };
      delete sanitizedEnv.ELECTRON_RUN_AS_NODE;

      cp.execFile(
        command,
        args,
        { timeout: 3000, env: sanitizedEnv },
        (error, _stdout, _stderr) => {
          if (error) {
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });
  }
}
