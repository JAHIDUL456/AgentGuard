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

export class CSharpAdapter extends BaseLanguageAdapter {
  public readonly id = 'csharp';
  public readonly displayName = 'C#';
  public readonly fileExtensions = ['.cs'];
  public readonly languageIds = ['csharp'];
  public readonly projectManifests = ['*.sln', '*.csproj'];
  public readonly capabilityLevel = CapabilityLevel.Level3_DependencyAnalysis;
  public readonly capabilities: readonly LanguageCapability[] = [
    'change-monitoring',
    'structural-analysis',
    'dependency-graph',
    'diagnostics',
  ];
  public readonly knownLimitations = [
    'Roslyn C# source generators are not evaluated without dotnet build or OmniSharp.',
    'Global using directives declared in separate files are not unified in single-file pass.',
  ];

  public override readonly tooling: ToolingInfo = {
    name: '.NET SDK',
    command: 'dotnet',
    isInstalled: async () => BaseLanguageAdapter.checkCommand('dotnet', ['--version']),
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

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        continue;
      }

      // 1. Using directives: using System.Text;
      const usingMatch = /^using\s+(?:static\s+)?([a-zA-Z0-9_.]+);/.exec(trimmed);
      if (usingMatch && usingMatch[1]) {
        imports.push(usingMatch[1]);
        continue;
      }

      // 2. Namespace declarations
      const nsMatch = /^namespace\s+([a-zA-Z0-9_.]+)/.exec(trimmed);
      if (nsMatch && nsMatch[1]) {
        nodes.push({
          kind: 'namespace',
          name: nsMatch[1],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 3. Class, Interface, Struct, Record, Enum declarations
      const typeMatch = /(?:public|protected|internal|private)?\s*(?:static|sealed|abstract|partial)?\s*(class|interface|struct|record|enum)\s+([a-zA-Z0-9_]+)/.exec(trimmed);
      if (typeMatch && typeMatch[1] && typeMatch[2]) {
        const rawKind = typeMatch[1];
        const kind =
          rawKind === 'class'
            ? 'class'
            : rawKind === 'interface'
              ? 'interface'
              : rawKind === 'enum'
                ? 'enum'
                : 'struct';

        nodes.push({
          kind,
          name: typeMatch[2],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 4. Method declarations
      const methodMatch = /(?:public|protected|internal|private|static|async|\s)+[\w<>[\],\s\?]+\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{?$/.exec(trimmed);
      if (methodMatch && methodMatch[1] && !trimmed.startsWith('if') && !trimmed.startsWith('for') && !trimmed.startsWith('while')) {
        nodes.push({
          kind: 'method',
          name: methodMatch[1],
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
