import * as path from 'path';
import * as ts from 'typescript';
import * as vscode from 'vscode';
import {
  ExportedSymbolInfo,
  ImportedSymbolInfo,
  ScopeAnalysisResult,
  ScopeKind,
  SymbolBinding,
  SymbolDeclarationKind,
} from './scope-types';

/**
 * Standard global identifiers across JavaScript, Browser/DOM, Node.js, React, and TypeScript.
 */
const BUILTIN_GLOBALS = new Set<string>([
  // JavaScript Runtime Built-ins
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Function',
  'Symbol',
  'BigInt',
  'Math',
  'Date',
  'RegExp',
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'Promise',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'JSON',
  'Reflect',
  'Proxy',
  'Intl',
  'ArrayBuffer',
  'DataView',
  'Float32Array',
  'Float64Array',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Uint8Array',
  'Uint16Array',
  'Uint32Array',
  'Uint8ClampedArray',
  'BigInt64Array',
  'BigUint64Array',
  'Infinity',
  'NaN',
  'undefined',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'escape',
  'unescape',
  'eval',
  'arguments',

  // Browser & Web APIs
  'window',
  'document',
  'console',
  'navigator',
  'location',
  'history',
  'screen',
  'localStorage',
  'sessionStorage',
  'fetch',
  'Headers',
  'Request',
  'Response',
  'FormData',
  'Blob',
  'File',
  'FileReader',
  'URL',
  'URLSearchParams',
  'Event',
  'CustomEvent',
  'UIEvent',
  'MouseEvent',
  'KeyboardEvent',
  'FocusEvent',
  'PointerEvent',
  'TouchEvent',
  'WheelEvent',
  'HTMLElement',
  'HTMLDivElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLFormElement',
  'HTMLSpanElement',
  'Element',
  'Node',
  'DocumentFragment',
  'MutationObserver',
  'IntersectionObserver',
  'ResizeObserver',
  'Performance',
  'performance',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'queueMicrotask',
  'alert',
  'prompt',
  'confirm',
  'crypto',
  'Crypto',
  'SubtleCrypto',
  'WebSocket',
  'XMLHttpRequest',
  'AbortController',
  'AbortSignal',

  // Node.js Globals
  'process',
  'Buffer',
  'global',
  '__dirname',
  '__filename',
  'module',
  'exports',
  'require',
  'setImmediate',
  'clearImmediate',
  'TextEncoder',
  'TextDecoder',

  // React & JSX
  'React',
  'JSX',

  // TypeScript Ambient Types & Utilities
  'Record',
  'Partial',
  'Required',
  'Readonly',
  'Pick',
  'Omit',
  'Exclude',
  'Extract',
  'NonNullable',
  'Parameters',
  'ConstructorParameters',
  'ReturnType',
  'InstanceType',
  'Uppercase',
  'Lowercase',
  'Capitalize',
  'Uncapitalize',
  'ThisParameterType',
  'OmitThisParameter',
  'ThisType',
  'Awaited',
  'any',
  'unknown',
  'never',
  'void',
  'string',
  'number',
  'boolean',
  'symbol',
  'bigint',
  'object',
  'null',
]);

class Scope {
  public readonly children: Scope[] = [];
  public readonly bindings = new Map<string, SymbolBinding>();

  constructor(
    public readonly kind: ScopeKind,
    public readonly parent: Scope | undefined
  ) {
    if (parent) {
      parent.children.push(this);
    }
  }

  public lookup(name: string): SymbolBinding | undefined {
    const binding = this.bindings.get(name);
    if (binding) {
      return binding;
    }
    if (this.parent) {
      return this.parent.lookup(name);
    }
    return undefined;
  }
}

export class TypeScriptScopeAnalyzer {
  /**
   * Performs lexical scope and AST symbol analysis on TypeScript / JavaScript code.
   */
  public analyze(uri: vscode.Uri, content: string): ScopeAnalysisResult {
    const fileName = path.basename(uri.fsPath);
    const ext = path.extname(uri.fsPath).toLowerCase();

    let scriptKind = ts.ScriptKind.TS;
    if (ext === '.tsx') {
      scriptKind = ts.ScriptKind.TSX;
    } else if (ext === '.jsx') {
      scriptKind = ts.ScriptKind.JSX;
    } else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      scriptKind = ts.ScriptKind.JS;
    }

    const sourceFile = ts.createSourceFile(
      fileName,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

    const moduleScope = new Scope('module', undefined);
    let currentScope: Scope = moduleScope;

    const allBindings = new Map<string, SymbolBinding>();
    const importedSymbols: ImportedSymbolInfo[] = [];
    const exportedSymbols: ExportedSymbolInfo[] = [];

    const identifierReferences: {
      name: string;
      range: vscode.Range;
      scope: Scope;
      isTypeReference?: boolean;
      isJsx?: boolean;
    }[] = [];

    const hasExportModifier = (targetNode: ts.Node): boolean => {
      if (ts.canHaveModifiers(targetNode)) {
        const modifiers = ts.getModifiers(targetNode);
        return modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      }
      return false;
    };

    const getRange = (node: ts.Node): vscode.Range => {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      return new vscode.Range(start.line, start.character, end.line, end.character);
    };

    const isExternalModule = (specifier: string): boolean => {
      return !specifier.startsWith('.') && !specifier.startsWith('/');
    };

    const addBinding = (
      name: string,
      kind: SymbolDeclarationKind,
      node: ts.Node,
      scope: Scope,
      options?: {
        isExported?: boolean;
        isTypeOnly?: boolean;
        isExternal?: boolean;
        originalImportName?: string;
        importModuleSpecifier?: string;
      }
    ): SymbolBinding => {
      const range = getRange(node);
      const binding: SymbolBinding = {
        name,
        kind,
        range,
        isExported: options?.isExported,
        isTypeOnly: options?.isTypeOnly,
        isExternal: options?.isExternal,
        originalImportName: options?.originalImportName,
        importModuleSpecifier: options?.importModuleSpecifier,
        references: 0,
      };

      scope.bindings.set(name, binding);
      allBindings.set(`${scope.kind}:${name}:${range.start.line}:${range.start.character}`, binding);
      return binding;
    };

    const extractBindingIdentifiers = (
      nameNode: ts.BindingName,
      callback: (id: ts.Identifier) => void
    ): void => {
      if (ts.isIdentifier(nameNode)) {
        callback(nameNode);
      } else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
        for (const element of nameNode.elements) {
          if (ts.isBindingElement(element)) {
            extractBindingIdentifiers(element.name, callback);
          }
        }
      }
    };

    // First pass: Traverse AST, build scope tree and bindings, record identifier references
    const visit = (node: ts.Node): void => {
      // 1. Module Imports
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : '';
        const isExternal = isExternalModule(moduleSpecifier);
        const isTypeOnly = node.importClause?.isTypeOnly ?? false;

        if (node.importClause) {
          // Default import: import React from 'react';
          if (node.importClause.name) {
            const localName = node.importClause.name.text;
            addBinding(localName, 'import', node.importClause.name, moduleScope, {
              isExternal,
              isTypeOnly,
              originalImportName: 'default',
              importModuleSpecifier: moduleSpecifier,
            });
            importedSymbols.push({
              localName,
              importedName: 'default',
              moduleSpecifier,
              isDefault: true,
              isNamespace: false,
              isTypeOnly,
              isExternal,
              range: getRange(node.importClause.name),
            });
          }

          if (node.importClause.namedBindings) {
            // Namespace import: import * as React from 'react';
            if (ts.isNamespaceImport(node.importClause.namedBindings)) {
              const localName = node.importClause.namedBindings.name.text;
              addBinding(localName, 'import', node.importClause.namedBindings.name, moduleScope, {
                isExternal,
                isTypeOnly,
                originalImportName: '*',
                importModuleSpecifier: moduleSpecifier,
              });
              importedSymbols.push({
                localName,
                importedName: '*',
                moduleSpecifier,
                isDefault: false,
                isNamespace: true,
                isTypeOnly,
                isExternal,
                range: getRange(node.importClause.namedBindings.name),
              });
            }
            // Named imports: import { GraphQLInt, Button as MyButton } from '...';
            else if (ts.isNamedImports(node.importClause.namedBindings)) {
              for (const element of node.importClause.namedBindings.elements) {
                const localName = element.name.text;
                const importedName = element.propertyName ? element.propertyName.text : localName;
                const specifierTypeOnly = isTypeOnly || element.isTypeOnly;

                addBinding(localName, 'import', element.name, moduleScope, {
                  isExternal,
                  isTypeOnly: specifierTypeOnly,
                  originalImportName: importedName,
                  importModuleSpecifier: moduleSpecifier,
                });
                importedSymbols.push({
                  localName,
                  importedName,
                  moduleSpecifier,
                  isDefault: false,
                  isNamespace: false,
                  isTypeOnly: specifierTypeOnly,
                  isExternal,
                  range: getRange(element.name),
                });
              }
            }
          }
        }
        return; // Do not traverse into import declaration children as expressions
      }

      // 2. Export Declarations (Track public API exports)
      const isExportedNode = hasExportModifier(node);

      if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) {
            const localName = el.propertyName ? el.propertyName.text : el.name.text;
            const exportedName = el.name.text;
            exportedSymbols.push({
              name: exportedName,
              kind: 'export',
              range: getRange(el),
            });
            // The exported local name is a reference to local symbol
            identifierReferences.push({
              name: localName,
              range: getRange(el),
              scope: currentScope,
            });
          }
        }
        return;
      }

      if (ts.isExportAssignment(node)) {
        // export default ...
        if (ts.isIdentifier(node.expression)) {
          identifierReferences.push({
            name: node.expression.text,
            range: getRange(node.expression),
            scope: currentScope,
          });
        }
        ts.forEachChild(node, visit);
        return;
      }

      // 3. Function Declarations
      if (ts.isFunctionDeclaration(node)) {
        if (node.name) {
          const fnName = node.name.text;
          addBinding(fnName, 'function', node.name, currentScope, {
            isExported: isExportedNode,
          });
          if (isExportedNode) {
            exportedSymbols.push({
              name: fnName,
              kind: 'function',
              range: getRange(node.name),
            });
          }
        }

        const fnScope = new Scope('function', currentScope);
        const prevScope = currentScope;
        currentScope = fnScope;

        // Bind parameters in function scope
        for (const param of node.parameters) {
          extractBindingIdentifiers(param.name, idNode => {
            addBinding(idNode.text, 'parameter', idNode, currentScope);
          });
        }

        ts.forEachChild(node, visit);
        currentScope = prevScope;
        return;
      }

      // 4. Arrow Functions & Function Expressions (e.g. .map((item, index) => ...))
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        const fnScope = new Scope('arrow', currentScope);
        const prevScope = currentScope;
        currentScope = fnScope;

        // If named function expression, bind name in its own scope
        if (ts.isFunctionExpression(node) && node.name) {
          addBinding(node.name.text, 'function', node.name, fnScope);
        }

        // Bind parameters in callback scope
        for (const param of node.parameters) {
          extractBindingIdentifiers(param.name, idNode => {
            addBinding(idNode.text, 'parameter', idNode, currentScope);
          });
        }

        ts.forEachChild(node, visit);
        currentScope = prevScope;
        return;
      }

      // 5. Classes & Interfaces & Type Aliases & Enums
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        addBinding(className, 'class', node.name, currentScope, {
          isExported: isExportedNode,
        });
        if (isExportedNode) {
          exportedSymbols.push({
            name: className,
            kind: 'class',
            range: getRange(node.name),
          });
        }
        const classScope = new Scope('class', currentScope);
        const prevScope = currentScope;
        currentScope = classScope;
        ts.forEachChild(node, visit);
        currentScope = prevScope;
        return;
      }

      if (ts.isInterfaceDeclaration(node)) {
        const ifaceName = node.name.text;
        addBinding(ifaceName, 'interface', node.name, currentScope, {
          isExported: isExportedNode,
          isTypeOnly: true,
        });
        if (isExportedNode) {
          exportedSymbols.push({
            name: ifaceName,
            kind: 'interface',
            range: getRange(node.name),
          });
        }
        ts.forEachChild(node, visit);
        return;
      }

      if (ts.isTypeAliasDeclaration(node)) {
        const typeName = node.name.text;
        addBinding(typeName, 'type-alias', node.name, currentScope, {
          isExported: isExportedNode,
          isTypeOnly: true,
        });
        if (isExportedNode) {
          exportedSymbols.push({
            name: typeName,
            kind: 'type-alias',
            range: getRange(node.name),
          });
        }
        ts.forEachChild(node, visit);
        return;
      }

      if (ts.isEnumDeclaration(node)) {
        const enumName = node.name.text;
        addBinding(enumName, 'enum', node.name, currentScope, {
          isExported: isExportedNode,
        });
        if (isExportedNode) {
          exportedSymbols.push({
            name: enumName,
            kind: 'enum',
            range: getRange(node.name),
          });
        }
        ts.forEachChild(node, visit);
        return;
      }

      // 6. Variable Statements & Declarations
      if (ts.isVariableDeclaration(node)) {
        const varStatement = node.parent?.parent;
        const isExported =
          varStatement && ts.isVariableStatement(varStatement)
            ? (varStatement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
            : false;

        extractBindingIdentifiers(node.name, idNode => {
          addBinding(idNode.text, 'variable', idNode, currentScope, {
            isExported,
          });
          if (isExported) {
            exportedSymbols.push({
              name: idNode.text,
              kind: 'variable',
              range: getRange(idNode),
            });
          }
        });

        if (node.initializer) {
          visit(node.initializer);
        }
        if (node.type) {
          visit(node.type);
        }
        return;
      }

      // 7. Catch Clause: catch (err)
      if (ts.isCatchClause(node)) {
        const catchScope = new Scope('catch', currentScope);
        const prevScope = currentScope;
        currentScope = catchScope;

        if (node.variableDeclaration) {
          extractBindingIdentifiers(node.variableDeclaration.name, idNode => {
            addBinding(idNode.text, 'variable', idNode, currentScope);
          });
        }

        visit(node.block);
        currentScope = prevScope;
        return;
      }

      // 8. For Loops
      if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        const forScope = new Scope('for', currentScope);
        const prevScope = currentScope;
        currentScope = forScope;
        ts.forEachChild(node, visit);
        currentScope = prevScope;
        return;
      }

      // 9. JSX Element References: <MyComponent />, <FaUser />, <icons.FaUser />
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        // In JSX files, React is implicitly referenced for JSX runtime transformation
        const reactBinding = moduleScope.lookup('React');
        if (reactBinding) {
          reactBinding.references++;
        }

        const tagName = node.tagName;
        if (ts.isIdentifier(tagName)) {
          // Check if uppercase (React component reference)
          const firstChar = tagName.text.charAt(0);
          if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
            identifierReferences.push({
              name: tagName.text,
              range: getRange(tagName),
              scope: currentScope,
              isJsx: true,
            });
          }
        } else if (ts.isPropertyAccessExpression(tagName)) {
          // E.g. <icons.FaUser /> -> icons is the referenced identifier
          if (ts.isIdentifier(tagName.expression)) {
            identifierReferences.push({
              name: tagName.expression.text,
              range: getRange(tagName.expression),
              scope: currentScope,
              isJsx: true,
            });
          }
        }

        // Visit JSX attributes and expressions
        ts.forEachChild(node, visit);
        return;
      }

      // 10. Shorthand Property Assignment: { user, count }
      if (ts.isShorthandPropertyAssignment(node)) {
        identifierReferences.push({
          name: node.name.text,
          range: getRange(node.name),
          scope: currentScope,
        });
        return;
      }

      // 11. Type References: let x: GraphQLInt
      if (ts.isTypeReferenceNode(node)) {
        if (ts.isIdentifier(node.typeName)) {
          identifierReferences.push({
            name: node.typeName.text,
            range: getRange(node.typeName),
            scope: currentScope,
            isTypeReference: true,
          });
        }
        if (node.typeArguments) {
          for (const arg of node.typeArguments) {
            visit(arg);
          }
        }
        return;
      }

      // 12. General Identifier References
      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        if (parent) {
          // Ignore identifiers that are property accesses: obj.prop (prop is ignored)
          if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
            return;
          }
          // Ignore property assignment keys: { prop: value } (prop is ignored)
          if (ts.isPropertyAssignment(parent) && parent.name === node) {
            return;
          }
          // Ignore JSX attribute names: <div key={1}> (key is attribute name, not variable)
          if (ts.isJsxAttribute(parent) && parent.name === node) {
            return;
          }
          // Ignore JSX opening, self-closing, and closing tag names (already handled in step 9)
          if (
            (ts.isJsxOpeningElement(parent) ||
              ts.isJsxSelfClosingElement(parent) ||
              ts.isJsxClosingElement(parent)) &&
            parent.tagName === node
          ) {
            return;
          }
          // Ignore destructuring property names: const { prop: val } = obj; (prop is ignored)
          if (ts.isBindingElement(parent) && parent.propertyName === node) {
            return;
          }
          // Ignore import property names: import { prop as alias } from '...'; (prop is ignored)
          if (ts.isImportSpecifier(parent) && parent.propertyName === node) {
            return;
          }
          // Ignore type reference names (already handled in step 11)
          if (ts.isTypeReferenceNode(parent) && parent.typeName === node) {
            return;
          }
          // Ignore method names, property signatures in types/interfaces
          if (
            (ts.isMethodDeclaration(parent) ||
              ts.isPropertySignature(parent) ||
              ts.isMethodSignature(parent) ||
              ts.isEnumMember(parent)) &&
            parent.name === node
          ) {
            return;
          }
        }

        identifierReferences.push({
          name: node.text,
          range: getRange(node),
          scope: currentScope,
        });
        return;
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // Second pass: Resolve identifier references against scopes
    const undefinedIdentifiers: {
      name: string;
      range: vscode.Range;
      isTypeReference?: boolean;
    }[] = [];

    const seenUndefined = new Set<string>();

    for (const ref of identifierReferences) {
      const binding = ref.scope.lookup(ref.name);
      if (binding) {
        binding.references++;
      } else {
        // Not found in lexical scope. Check built-in globals.
        if (BUILTIN_GLOBALS.has(ref.name)) {
          continue;
        }

        const key = `${ref.name}:${ref.range.start.line}:${ref.range.start.character}`;
        if (!seenUndefined.has(key)) {
          seenUndefined.add(key);
          undefinedIdentifiers.push({
            name: ref.name,
            range: ref.range,
            isTypeReference: ref.isTypeReference,
          });
        }
      }
    }

    // Third pass: Categorize unused bindings
    const unusedImports: {
      name: string;
      moduleSpecifier: string;
      range: vscode.Range;
    }[] = [];

    const unusedVariables: {
      name: string;
      kind: SymbolDeclarationKind;
      range: vscode.Range;
    }[] = [];

    const unusedParameters: {
      name: string;
      range: vscode.Range;
    }[] = [];

    for (const binding of allBindings.values()) {
      if (binding.references > 0 || binding.isExported) {
        continue;
      }

      // Ignore parameters with underscore prefix (e.g. `_`, `_req`, `_idx`)
      if (binding.kind === 'parameter') {
        if (!binding.name.startsWith('_')) {
          unusedParameters.push({
            name: binding.name,
            range: binding.range,
          });
        }
        continue;
      }

      if (binding.kind === 'import') {
        unusedImports.push({
          name: binding.name,
          moduleSpecifier: binding.importModuleSpecifier ?? 'unknown',
          range: binding.range,
        });
      } else if (binding.kind === 'variable' || binding.kind === 'function') {
        if (!binding.name.startsWith('_')) {
          unusedVariables.push({
            name: binding.name,
            kind: binding.kind,
            range: binding.range,
          });
        }
      }
    }

    return {
      undefinedIdentifiers,
      unusedImports,
      unusedVariables,
      unusedParameters,
      importedSymbols,
      exportedSymbols,
      bindings: allBindings,
    };
  }
}
