import * as path from 'path';
import * as ts from 'typescript';
import * as vscode from 'vscode';
import { ILogger } from '../../core/logger';
import { BaseLanguageAdapter } from '../base-adapter';
import {
  CapabilityLevel,
  LanguageCapability,
  LanguageDiagnostic,
  StructuralAnalysisResult,
  StructuralNode,
} from '../types';

export class TypeScriptAdapter extends BaseLanguageAdapter {
  public readonly id = 'typescript';
  public readonly displayName = 'TypeScript';
  public readonly fileExtensions = ['.ts', '.tsx', '.mts', '.cts'];
  public readonly languageIds = ['typescript', 'typescriptreact'];
  public readonly projectManifests = ['tsconfig.json'];
  public readonly capabilityLevel = CapabilityLevel.Level4_DiagnosticsIntegration;
  public readonly capabilities: readonly LanguageCapability[] = [
    'change-monitoring',
    'structural-analysis',
    'dependency-graph',
    'diagnostics',
  ];
  public readonly knownLimitations = [
    'Deep cross-file type symbol resolution requires full ts.Program compilation (Level 5).',
    'Bundler-specific path aliases (e.g. webpack virtual modules) are parsed as literal specifiers.',
  ];

  constructor(logger: ILogger) {
    super(logger);
  }

  protected override async _doParseStructure(
    uri: vscode.Uri,
    content: string
  ): Promise<StructuralAnalysisResult> {
    const fileName = path.basename(uri.fsPath);
    const sourceFile = ts.createSourceFile(
      fileName,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const nodes: StructuralNode[] = [];
    const imports: string[] = [];
    const syntaxErrors: LanguageDiagnostic[] = [];

    // 1. Collect syntax errors reported by the parser
    const diagnostics = (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] })
      .parseDiagnostics ?? [];

    for (const diag of diagnostics) {
      const pos = diag.start !== undefined ? sourceFile.getLineAndCharacterOfPosition(diag.start) : { line: 0, character: 0 };
      const message = typeof diag.messageText === 'string'
        ? diag.messageText
        : diag.messageText.messageText;

      syntaxErrors.push({
        message,
        line: pos.line,
        character: pos.character,
        severity: 'error',
        source: 'typescript-compiler',
      });
    }

    // 2. Walk AST to extract structural nodes and imports
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        if (ts.isStringLiteral(node.moduleSpecifier)) {
          imports.push(node.moduleSpecifier.text);
        }
      } else if (ts.isClassDeclaration(node) && node.name) {
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        nodes.push({
          kind: 'class',
          name: node.name.text,
          startLine,
          endLine,
        });
      } else if (ts.isInterfaceDeclaration(node)) {
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        nodes.push({
          kind: 'interface',
          name: node.name.text,
          startLine,
          endLine,
        });
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        nodes.push({
          kind: 'function',
          name: node.name.text,
          startLine,
          endLine,
        });
      } else if (ts.isEnumDeclaration(node)) {
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        nodes.push({
          kind: 'enum',
          name: node.name.text,
          startLine,
          endLine,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

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
