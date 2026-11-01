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

export class JavaAdapter extends BaseLanguageAdapter {
  public readonly id = 'java';
  public readonly displayName = 'Java';
  public readonly fileExtensions = ['.java'];
  public readonly languageIds = ['java'];
  public readonly projectManifests = ['pom.xml', 'build.gradle', 'build.gradle.kts'];
  public readonly capabilityLevel = CapabilityLevel.Level3_DependencyAnalysis;
  public readonly capabilities: readonly LanguageCapability[] = [
    'change-monitoring',
    'structural-analysis',
    'dependency-graph',
    'diagnostics',
  ];
  public readonly knownLimitations = [
    'Annotation processing (e.g. Lombok, MapStruct) is not executed in static pass.',
    'Class hierarchy verification requires Maven/Gradle build or Eclipse JDT language server.',
  ];

  public override readonly tooling: ToolingInfo = {
    name: 'Java Development Kit (javac)',
    command: 'javac',
    isInstalled: async () => BaseLanguageAdapter.checkCommand('javac', ['-version']),
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

      // 1. Import statements: import java.util.List;
      const importMatch = /^import\s+(?:static\s+)?([a-zA-Z0-9_.*]+);/.exec(trimmed);
      if (importMatch && importMatch[1]) {
        imports.push(importMatch[1]);
        continue;
      }

      // 2. Class, Interface, Record, Enum declarations
      const typeMatch = /(?:public|protected|private)?\s*(?:abstract|final|static)?\s*(class|interface|record|enum)\s+([a-zA-Z0-9_]+)/.exec(trimmed);
      if (typeMatch && typeMatch[1] && typeMatch[2]) {
        const kind = typeMatch[1] as 'class' | 'interface' | 'enum';
        nodes.push({
          kind,
          name: typeMatch[2],
          startLine: i,
          endLine: i,
        });
        continue;
      }

      // 3. Method declarations: public void doSomething(...)
      const methodMatch = /(?:public|protected|private|static|\s)+[\w<>[\],\s]+\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{?$/.exec(trimmed);
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
