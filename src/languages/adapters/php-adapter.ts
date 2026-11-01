import * as vscode from 'vscode';
import { ILogger } from '../../core/logger';
import { BaseLanguageAdapter } from '../base-adapter';
import {
  CapabilityLevel,
  LanguageCapability,
  LanguageDiagnostic,
  StructuralAnalysisResult,
  StructuralNode,
  ToolingInfo,
} from '../types';

export class PhpAdapter extends BaseLanguageAdapter {
  public readonly id = 'php';
  public readonly displayName = 'PHP';
  public readonly fileExtensions = ['.php'];
  public readonly languageIds = ['php'];
  public readonly projectManifests = ['composer.json'];
  public readonly capabilityLevel = CapabilityLevel.Level3_DependencyAnalysis;
  public readonly capabilities: readonly LanguageCapability[] = [
    'change-monitoring',
    'structural-analysis',
    'dependency-graph',
    'diagnostics',
  ];
  public readonly knownLimitations = [
    'Dynamic method invocations ($obj->$method()) cannot be resolved statically.',
    'Autoloader class-map verification requires composer dump-autoload.',
  ];

  public override readonly tooling: ToolingInfo = {
    name: 'PHP CLI',
    command: 'php',
    isInstalled: async () => BaseLanguageAdapter.checkCommand('php', ['-v']),
  };

  constructor(logger: ILogger) {
    super(logger);
  }

  protected override async _doParseStructure(
    _uri: vscode.Uri,
    content: string
  ): Promise<StructuralAnalysisResult> {
    const nodes: StructuralNode[] = [];
    const imports: string[] = [];
    const syntaxErrors: LanguageDiagnostic[] = [];

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
        continue;
      }

      // 1. Use statements: use App\Models\User;
      const useMatch = /^use\s+([a-zA-Z0-9_\\]+);/.exec(trimmed);
      if (useMatch && useMatch[1]) {
        imports.push(useMatch[1]);
        continue;
      }

      // 2. Namespace
      const nsMatch = /^namespace\s+([a-zA-Z0-9_\\]+);/.exec(trimmed);
      if (nsMatch && nsMatch[1]) {
        nodes.push({
          kind: 'namespace',
          name: nsMatch[1],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 3. Class, Interface, Trait, Enum declarations
      const typeMatch = /(?:abstract|final)?\s*(class|interface|trait|enum)\s+([a-zA-Z0-9_]+)/.exec(trimmed);
      if (typeMatch && typeMatch[1] && typeMatch[2]) {
        const raw = typeMatch[1];
        const kind = raw === 'trait' ? 'trait' : raw === 'interface' ? 'interface' : raw === 'enum' ? 'enum' : 'class';
        nodes.push({
          kind,
          name: typeMatch[2],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 4. Function declarations: function name(...)
      const funcMatch = /(?:public|protected|private|static|\s)*function\s+([a-zA-Z0-9_]+)\s*\(/.exec(trimmed);
      if (funcMatch && funcMatch[1]) {
        nodes.push({
          kind: 'function',
          name: funcMatch[1],
          startLine: i,
          endLine: i,
        });
        continue;
      }
    }

    return {
      nodes,
      imports,
      syntaxErrors,
    };
  }

  protected override async _doExtractDependencies(
    uri: vscode.Uri,
    content: string
  ): Promise<readonly string[]> {
    const res = await this._doParseStructure(uri, content);
    return res.imports;
  }
}
