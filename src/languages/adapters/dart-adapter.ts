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

export class DartAdapter extends BaseLanguageAdapter {
  public readonly id = 'dart';
  public readonly displayName = 'Dart';
  public readonly fileExtensions = ['.dart'];
  public readonly languageIds = ['dart'];
  public readonly projectManifests = ['pubspec.yaml'];
  public readonly capabilityLevel = CapabilityLevel.Level3_DependencyAnalysis;
  public readonly capabilities: readonly LanguageCapability[] = [
    'change-monitoring',
    'structural-analysis',
    'dependency-graph',
    'diagnostics',
  ];
  public readonly knownLimitations = [
    'Code generated via build_runner (.g.dart parts) is parsed purely from source references.',
    'Sound null safety type verification requires the Dart Analysis Server.',
  ];

  public override readonly tooling: ToolingInfo = {
    name: 'Dart SDK',
    command: 'dart',
    isInstalled: async () => BaseLanguageAdapter.checkCommand('dart', ['--version']),
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

      // 1. Imports: import 'package:flutter/material.dart';
      const importMatch = /^import\s+['"]([^'"]+)['"]/.exec(trimmed);
      if (importMatch && importMatch[1]) {
        imports.push(importMatch[1]);
        continue;
      }

      // 2. Class, Mixin, Extension, Enum
      const typeMatch = /(?:abstract\s+)?(class|mixin|extension|enum)\s+([a-zA-Z0-9_]+)/.exec(trimmed);
      if (typeMatch && typeMatch[1] && typeMatch[2]) {
        const raw = typeMatch[1];
        const kind = raw === 'enum' ? 'enum' : 'class';
        nodes.push({
          kind,
          name: typeMatch[2],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 3. Top-level functions or methods
      const funcMatch = /(?:void|Future<[^>]+>|String|int|bool|dynamic|Widget)\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?:async\s*)?\{?$/.exec(trimmed);
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

