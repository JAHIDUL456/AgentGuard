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

export class GoAdapter extends BaseLanguageAdapter {
  public readonly id = 'go';
  public readonly displayName = 'Go';
  public readonly fileExtensions = ['.go'];
  public readonly languageIds = ['go'];
  public readonly projectManifests = ['go.mod'];
  public readonly capabilityLevel = CapabilityLevel.Level3_DependencyAnalysis;
  public readonly capabilities: readonly LanguageCapability[] = [
    'change-monitoring',
    'structural-analysis',
    'dependency-graph',
    'diagnostics',
  ];
  public readonly knownLimitations = [
    'CGo embedded C bindings are not parsed.',
    'Full type check and interface implementation verification requires gopls or go build.',
  ];

  public override readonly tooling: ToolingInfo = {
    name: 'Go Toolchain',
    command: 'go',
    isInstalled: async () => BaseLanguageAdapter.checkCommand('go', ['version']),
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
    let insideImportBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('//')) {
        continue;
      }

      // 1. Import block parsing
      if (trimmed === 'import (') {
        insideImportBlock = true;
        continue;
      }

      if (insideImportBlock) {
        if (trimmed === ')') {
          insideImportBlock = false;
          continue;
        }
        const match = /"([^"]+)"/.exec(trimmed);
        if (match && match[1]) {
          imports.push(match[1]);
        }
        continue;
      }

      // Single import: import "fmt" or import p "path"
      const singleImportMatch = /^import\s+(?:[a-zA-Z0-9_.]+\s+)?"([^"]+)"/.exec(trimmed);
      if (singleImportMatch && singleImportMatch[1]) {
        imports.push(singleImportMatch[1]);
        continue;
      }

      // 2. Function declarations: func Name(...) or func (r Receiver) Method(...)
      const funcMatch = /^func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/.exec(trimmed);
      if (funcMatch && funcMatch[1]) {
        const isMethod = /^func\s+\(/.test(trimmed);
        nodes.push({
          kind: isMethod ? 'method' : 'function',
          name: funcMatch[1],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 3. Type declarations: type Name struct / type Name interface
      const typeMatch = /^type\s+([a-zA-Z0-9_]+)\s+(struct|interface)/.exec(trimmed);
      if (typeMatch && typeMatch[1] && typeMatch[2]) {
        nodes.push({
          kind: typeMatch[2] === 'struct' ? 'struct' : 'interface',
          name: typeMatch[1],
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
