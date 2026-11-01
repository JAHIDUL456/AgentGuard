import * as vscode from 'vscode';
import { StructuralNode } from '../../languages/types';

export type SymbolChangeKind =
  | 'deleted'
  | 'renamed'
  | 'signature-changed'
  | 'added'
  | 'modified';

export interface SymbolChange {
  readonly name: string;
  readonly kind: StructuralNode['kind'];
  readonly changeKind: SymbolChangeKind;
  readonly oldNode?: StructuralNode;
  readonly newNode?: StructuralNode;
  readonly details?: string;
  readonly line?: number;
}

export interface FileStructuralDiff {
  readonly uri: vscode.Uri;
  readonly relativeFilePath: string;
  readonly changes: readonly SymbolChange[];
  readonly previousNodes: readonly StructuralNode[];
  readonly currentNodes: readonly StructuralNode[];
}

export interface DependencyLink {
  readonly consumerUri: vscode.Uri;
  readonly consumerRelativePath: string;
  readonly providerUri: vscode.Uri;
  readonly importedSymbols: readonly string[];
  readonly isDynamic: boolean;
  readonly rawImport: string;
  readonly line: number;
}
