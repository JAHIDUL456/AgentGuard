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

export class RustAdapter extends BaseLanguageAdapter {
  public readonly id = 'rust';
  public readonly displayName = 'Rust';
  public readonly fileExtensions = ['.rs'];
  public readonly languageIds = ['rust'];
  public readonly projectManifests = ['Cargo.toml'];
  public readonly capabilityLevel = CapabilityLevel.Level3_DependencyAnalysis;
  public readonly capabilities: readonly LanguageCapability[] = [
    'change-monitoring',
    'structural-analysis',
    'dependency-graph',
    'diagnostics',
  ];
  public readonly knownLimitations = [
    'Complex procedural macro expansions cannot be analyzed without rust-analyzer or cargo.',
    'Trait coherence and borrow checker guarantees require rustc.',
  ];

  public override readonly tooling: ToolingInfo = {
    name: 'Rust Cargo',
    command: 'cargo',
    isInstalled: async () => BaseLanguageAdapter.checkCommand('cargo', ['--version']),
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

      if (!trimmed || trimmed.startsWith('//')) {
        continue;
      }

      // 1. Dependency imports: use foo::bar;
      const useMatch = /^pub(?:\([^)]+\))?\s+use\s+([^;]+);|^use\s+([^;]+);/.exec(trimmed);
      const usePath = useMatch ? (useMatch[1] || useMatch[2]) : undefined;
      if (usePath) {
        const rootCrate = usePath.trim().split('::')[0]!;
        if (rootCrate) {
          imports.push(rootCrate);
        }
        continue;
      }

      // 2. Struct declarations
      const structMatch = /^(?:pub(?:\([^)]+\))?\s+)?struct\s+([a-zA-Z0-9_]+)/.exec(trimmed);
      if (structMatch && structMatch[1]) {
        nodes.push({
          kind: 'struct',
          name: structMatch[1],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 3. Enum declarations
      const enumMatch = /^(?:pub(?:\([^)]+\))?\s+)?enum\s+([a-zA-Z0-9_]+)/.exec(trimmed);
      if (enumMatch && enumMatch[1]) {
        nodes.push({
          kind: 'enum',
          name: enumMatch[1],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 4. Trait declarations
      const traitMatch = /^(?:pub(?:\([^)]+\))?\s+)?trait\s+([a-zA-Z0-9_]+)/.exec(trimmed);
      if (traitMatch && traitMatch[1]) {
        nodes.push({
          kind: 'trait',
          name: traitMatch[1],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 5. Function declarations
      const fnMatch = /^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/.exec(trimmed);
      if (fnMatch && fnMatch[1]) {
        nodes.push({
          kind: 'function',
          name: fnMatch[1],
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

