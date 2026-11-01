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

export class PythonAdapter extends BaseLanguageAdapter {
  public readonly id = 'python';
  public readonly displayName = 'Python';
  public readonly fileExtensions = ['.py', '.pyi'];
  public readonly languageIds = ['python'];
  public readonly projectManifests = [
    'pyproject.toml',
    'requirements.txt',
    'Pipfile',
    'setup.py',
  ];
  public readonly capabilityLevel = CapabilityLevel.Level3_DependencyAnalysis;
  public readonly capabilities: readonly LanguageCapability[] = [
    'change-monitoring',
    'structural-analysis',
    'dependency-graph',
    'diagnostics',
  ];
  public readonly knownLimitations = [
    'Dynamic imports via importlib or __import__ cannot be statically resolved.',
    'Full type inference requires external tools like Pyright or Mypy.',
  ];

  public override readonly tooling: ToolingInfo = {
    name: 'Python 3',
    command: 'python3',
    isInstalled: async () => BaseLanguageAdapter.checkCommand('python3', ['--version']),
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
    let openParens = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // Skip empty or comment lines
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      openParens += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;

      // 1. Dependency imports
      // import foo, bar
      const importMatch = /^import\s+([a-zA-Z0-9_.,\s]+)/.exec(trimmed);
      if (importMatch && importMatch[1]) {
        const modules = importMatch[1].split(',').map(m => m.trim().split(/\s+as\s+/)[0]!);
        for (const mod of modules) {
          if (mod) {
            imports.push(mod);
          }
        }
      }

      // from foo.bar import baz
      const fromMatch = /^from\s+([a-zA-Z0-9_.]+)\s+import\s+/.exec(trimmed);
      if (fromMatch && fromMatch[1]) {
        imports.push(fromMatch[1]);
      }

      // 2. Class declarations
      const classMatch = /^class\s+([a-zA-Z0-9_]+)/.exec(trimmed);
      if (classMatch && classMatch[1]) {
        nodes.push({
          kind: 'class',
          name: classMatch[1],
          startLine: i,
          endLine: i,
        });
      }

      // 3. Function / method declarations
      const funcMatch = /^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(/.exec(trimmed);
      if (funcMatch && funcMatch[1]) {
        const isMethod = /^\s{2,}/.test(line);
        nodes.push({
          kind: isMethod ? 'method' : 'function',
          name: funcMatch[1],
          startLine: i,
          endLine: i,
        });
      }

      // 4. Basic syntax check: missing colon on def/class
      if ((trimmed.startsWith('def ') || trimmed.startsWith('class ') || trimmed.startsWith('async def ')) && !trimmed.endsWith(':')) {
        // Only if it doesn't span multiple lines (simple check)
        if (!trimmed.includes('(') || trimmed.includes(')')) {
          syntaxErrors.push({
            message: `SyntaxError: expected ':' at end of declaration`,
            line: i,
            character: line.length - 1,
            severity: 'error',
            source: 'python-parser',
          });
        }
      }
    }

    if (openParens > 0) {
      syntaxErrors.push({
        message: "SyntaxError: unexpected EOF while parsing (unclosed parenthesis)",
        line: lines.length - 1,
        character: 0,
        severity: 'error',
        source: 'python-parser',
      });
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
