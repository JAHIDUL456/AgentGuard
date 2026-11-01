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

export class CAdapter extends BaseLanguageAdapter {
  public readonly id = 'c';
  public readonly displayName = 'C';
  public readonly fileExtensions = ['.c', '.h'];
  public readonly languageIds = ['c'];
  public readonly projectManifests = ['CMakeLists.txt', 'Makefile'];
  public readonly capabilityLevel = CapabilityLevel.Level3_DependencyAnalysis;
  public readonly capabilities: readonly LanguageCapability[] = [
    'change-monitoring',
    'structural-analysis',
    'dependency-graph',
    'diagnostics',
  ];
  public readonly knownLimitations = [
    'Preprocessor conditionals (#ifdef, #if) are not evaluated without compiler preprocessing.',
    'Function-like macros are parsed without expansion.',
  ];

  public override readonly tooling: ToolingInfo = {
    name: 'Clang / GCC C Compiler',
    command: 'clang',
    isInstalled: async () => {
      const hasClang = await BaseLanguageAdapter.checkCommand('clang', ['--version']);
      if (hasClang) {
        return true;
      }
      return BaseLanguageAdapter.checkCommand('gcc', ['--version']);
    },
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

      // 1. #include <header.h> or #include "local.h"
      const incMatch = /^#\s*include\s+[<"]([^>"]+)[>"]/.exec(trimmed);
      if (incMatch && incMatch[1]) {
        imports.push(incMatch[1]);
        continue;
      }

      // 2. Struct or Enum: struct Point { or typedef struct Point {
      const structMatch = /^(?:typedef\s+)?(struct|enum)\s+([a-zA-Z0-9_]+)\s*(?:\{|;|$)/.exec(trimmed);
      if (structMatch && structMatch[1] && structMatch[2]) {
        nodes.push({
          kind: structMatch[1] === 'struct' ? 'struct' : 'enum',
          name: structMatch[2],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 3. C Function declarations: int main(...) or void calculate(...)
      const funcMatch = /(?:static\s+|inline\s+|extern\s+)?(?:void|int|char|float|double|size_t|bool|[a-zA-Z0-9_]+_t|[a-zA-Z0-9_]+)\s*\**\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{?$/.exec(trimmed);
      if (funcMatch && funcMatch[1] && !trimmed.startsWith('if') && !trimmed.startsWith('while') && !trimmed.startsWith('return')) {
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
