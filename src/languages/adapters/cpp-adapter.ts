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

export class CppAdapter extends BaseLanguageAdapter {
  public readonly id = 'cpp';
  public readonly displayName = 'C++';
  public readonly fileExtensions = [
    '.cpp',
    '.cc',
    '.cxx',
    '.hpp',
    '.hh',
    '.hxx',
  ];
  public readonly languageIds = ['cpp'];
  public readonly projectManifests = ['CMakeLists.txt', 'Makefile'];
  public readonly capabilityLevel = CapabilityLevel.Level3_DependencyAnalysis;
  public readonly capabilities: readonly LanguageCapability[] = [
    'change-monitoring',
    'structural-analysis',
    'dependency-graph',
    'diagnostics',
  ];
  public readonly knownLimitations = [
    'Complex template metaprogramming substitutions are not expanded without clangd or compiler.',
    'C++20 module binary interfaces (.bmi) require compilation flags from compile_commands.json.',
  ];

  public override readonly tooling: ToolingInfo = {
    name: 'Clang++ / G++ C++ Compiler',
    command: 'clang++',
    isInstalled: async () => {
      const hasClang = await BaseLanguageAdapter.checkCommand('clang++', ['--version']);
      if (hasClang) {
        return true;
      }
      return BaseLanguageAdapter.checkCommand('g++', ['--version']);
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

      // 1. #include <header> or #include "header.hpp"
      const incMatch = /^#\s*include\s+[<"]([^>"]+)[>"]/.exec(trimmed);
      if (incMatch && incMatch[1]) {
        imports.push(incMatch[1]);
        continue;
      }

      // 2. Namespace: namespace foo {
      const nsMatch = /^namespace\s+([a-zA-Z0-9_]+)/.exec(trimmed);
      if (nsMatch && nsMatch[1]) {
        nodes.push({
          kind: 'namespace',
          name: nsMatch[1],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 3. Class or Struct: class Engine : public Base {
      const classMatch = /(?:template\s*<[^>]*>\s*)?(?:class|struct)\s+([a-zA-Z0-9_]+)/.exec(trimmed);
      if (classMatch && classMatch[1] && !trimmed.startsWith('enum')) {
        nodes.push({
          kind: 'class',
          name: classMatch[1],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 4. Methods / Functions
      const funcMatch = /(?:virtual\s+|static\s+|inline\s+|explicit\s+)?[\w<>&*:\s]+\s+([a-zA-Z0-9_:]+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{?$/.exec(trimmed);
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

