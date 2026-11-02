import * as vscode from 'vscode';

export type ScopeKind =
  | 'module'
  | 'function'
  | 'arrow'
  | 'block'
  | 'class'
  | 'catch'
  | 'for';

export type SymbolDeclarationKind =
  | 'import'
  | 'variable'
  | 'parameter'
  | 'function'
  | 'class'
  | 'interface'
  | 'type-alias'
  | 'enum';

export interface SymbolBinding {
  readonly name: string;
  readonly kind: SymbolDeclarationKind;
  readonly range: vscode.Range;
  readonly isExported?: boolean;
  readonly isTypeOnly?: boolean;
  readonly isExternal?: boolean;
  readonly originalImportName?: string;
  readonly importModuleSpecifier?: string;
  references: number;
}

export interface IdentifierReference {
  readonly name: string;
  readonly range: vscode.Range;
  readonly isTypeReference?: boolean;
  readonly isJsx?: boolean;
}

export interface ImportedSymbolInfo {
  readonly localName: string;
  readonly importedName: string;
  readonly moduleSpecifier: string;
  readonly isDefault: boolean;
  readonly isNamespace: boolean;
  readonly isTypeOnly: boolean;
  readonly isExternal: boolean;
  readonly range: vscode.Range;
}

export interface ExportedSymbolInfo {
  readonly name: string;
  readonly kind: string;
  readonly range: vscode.Range;
}

export interface ScopeAnalysisResult {
  readonly undefinedIdentifiers: readonly {
    readonly name: string;
    readonly range: vscode.Range;
    readonly isTypeReference?: boolean;
  }[];
  readonly unusedImports: readonly {
    readonly name: string;
    readonly moduleSpecifier: string;
    readonly range: vscode.Range;
  }[];
  readonly unusedVariables: readonly {
    readonly name: string;
    readonly kind: SymbolDeclarationKind;
    readonly range: vscode.Range;
  }[];
  readonly unusedParameters: readonly {
    readonly name: string;
    readonly range: vscode.Range;
  }[];
  readonly importedSymbols: readonly ImportedSymbolInfo[];
  readonly exportedSymbols: readonly ExportedSymbolInfo[];
  readonly bindings: ReadonlyMap<string, SymbolBinding>;
}

