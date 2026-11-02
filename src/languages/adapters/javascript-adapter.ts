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

export class JavaScriptAdapter extends BaseLanguageAdapter {
  public readonly id = 'javascript';
  public readonly displayName = 'JavaScript';
  public readonly fileExtensions = ['.js', '.jsx', '.mjs', '.cjs'];
  public readonly languageIds = ['javascript', 'javascriptreact'];
  public readonly projectManifests = ['package.json', 'jsconfig.json'];
  public readonly capabilityLevel = CapabilityLevel.Level4_DiagnosticsIntegration;
  public readonly capabilities: readonly LanguageCapability[] = [
    'change-monitoring',
    'structural-analysis',
    'dependency-graph',
    'diagnostics',
  ];
  public readonly knownLimitations = [
    'Dynamic runtime require() calls with computed expressions cannot be statically resolved.',
  ];

  constructor(logger: ILogger) {
    super(logger);
  }

  protected override async _doParseStructure(
    uri: vscode.Uri,
    content: string
  ): Promise<StructuralAnalysisResult> {
    const fileName = path.basename(uri.fsPath);
    const ext = path.extname(uri.fsPath).toLowerCase();
    const scriptKind = ext === '.jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS;

    const sourceFile = ts.createSourceFile(
      fileName,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

    const nodes: StructuralNode[] = [];
    const imports: string[] = [];
    const syntaxErrors: LanguageDiagnostic[] = [];

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
        source: 'javascript-parser',
      });
    }

    const visit = (node: ts.Node): void => {
      // ES module import
      if (ts.isImportDeclaration(node)) {
        if (ts.isStringLiteral(node.moduleSpecifier)) {
          imports.push(node.moduleSpecifier.text);
        }
      }
      // CommonJS require('...')
      else if (ts.isCallExpression(node)) {
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'require' &&
          node.arguments.length > 0
        ) {
          const firstArg = node.arguments[0];
          if (firstArg && ts.isStringLiteral(firstArg)) {
            imports.push(firstArg.text);
          }
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
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        nodes.push({
          kind: 'function',
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

