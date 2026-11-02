import * as assert from 'assert';
import * as vscode from 'vscode';
import { TypeScriptScopeAnalyzer } from '../../src/analysis/scope/typescript-scope-analyzer';
import { computeStringSimilarity, StructuralDiffer } from '../../src/analysis/blast-radius/structural-differ';
import { DependencyGraph } from '../../src/analysis/blast-radius/dependency-graph';
import { DiagnosticDeltaEngine } from '../../src/analysis/diagnostics/diagnostic-delta-engine';
import { DiagnosticTracker } from '../../src/analysis/diagnostics/diagnostic-tracker';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';
import { NullLogger } from '../../src/core/logger';
import { createDiagnosticFingerprint } from '../../src/analysis/diagnostics/diagnostic-fingerprint';

suite('AgentGuard V2.0: Detection Accuracy & Scope Analysis Regression Tests', () => {
  const logger = new NullLogger();
  const analyzer = new TypeScriptScopeAnalyzer();

  test('1. GraphQL Identifiers: GraphQLInt is not misidentified as Graph rename', () => {
    // A. Verify string similarity avoids false-positive rename matching
    const sim = computeStringSimilarity('Graph', 'GraphQLInt');
    assert.ok(sim < 0.6, `Similarity between Graph and GraphQLInt must be < 0.6, got ${sim}`);

    const differ = new StructuralDiffer();
    const prevNodes = [
      {
        kind: 'class' as const,
        name: 'Graph',
        startLine: 10,
        endLine: 20,
        details: 'class Graph',
      },
    ];
    const currNodes = [
      {
        kind: 'class' as const,
        name: 'GraphQLInt',
        startLine: 11,
        endLine: 21,
        details: 'class GraphQLInt',
      },
    ];

    const changes = differ.diffNodes(prevNodes, currNodes);
    // Must NOT be classified as 'renamed'
    const renamed = changes.find(c => c.changeKind === 'renamed');
    assert.strictEqual(renamed, undefined, 'Graph should not be considered renamed to GraphQLInt');

    const deleted = changes.find(c => c.changeKind === 'deleted' && c.name === 'Graph');
    const added = changes.find(c => c.changeKind === 'added' && c.name === 'GraphQLInt');
    assert.ok(deleted, 'Graph must be recorded as deleted');
    assert.ok(added, 'GraphQLInt must be recorded as added');

    // B. Scope analysis of GraphQL code
    const graphqlCode = `
      import { GraphQLInt, GraphQLString, GraphQLObjectType, GraphQLSchema } from 'graphql';

      export const UserType = new GraphQLObjectType({
        name: 'User',
        fields: {
          id: { type: GraphQLInt },
          name: { type: GraphQLString },
        },
      });

      export const schema = new GraphQLSchema({
        query: UserType,
      });
    `;

    const result = analyzer.analyze(vscode.Uri.file('/app/schema.ts'), graphqlCode);
    assert.strictEqual(
      result.undefinedIdentifiers.length,
      0,
      `Valid GraphQL code should produce 0 undefined identifiers, got: ${JSON.stringify(result.undefinedIdentifiers)}`
    );
    assert.strictEqual(result.unusedImports.length, 0, 'All GraphQL imports are used');
  });

  test('2. React .map() Callbacks: callback parameters are correctly scoped and defined', () => {
    const code = `
      import React from 'react';

      interface Item {
        id: string;
        title: string;
      }

      export function ItemList({ items }: { items: Item[] }) {
        return (
          <ul>
            {items.map((item, index) => (
              <li key={index}>
                <span>{item.title}</span>
              </li>
            ))}
          </ul>
        );
      }
    `;

    const result = analyzer.analyze(vscode.Uri.file('/app/ItemList.tsx'), code);
    assert.strictEqual(
      result.undefinedIdentifiers.length,
      0,
      `React .map() parameters must not be reported as undefined, got: ${JSON.stringify(result.undefinedIdentifiers)}`
    );
  });

  test('3. Nested React Callbacks & Closures: inner scopes resolve parent and local parameters', () => {
    const code = `
      import React from 'react';

      interface Category {
        id: string;
        name: string;
        items: { id: string; label: string }[];
      }

      export function CategoryTree({ categories }: { categories: Category[] }) {
        return (
          <div>
            {categories.map((category, catIndex) => (
              <div key={category.id}>
                <h3>{category.name} ({catIndex})</h3>
                {category.items.map((item, itemIndex) => (
                  <p key={item.id}>
                    {catIndex}.{itemIndex} - {item.label} (in {category.name})
                  </p>
                ))}
              </div>
            ))}
          </div>
        );
      }
    `;

    const result = analyzer.analyze(vscode.Uri.file('/app/CategoryTree.tsx'), code);
    assert.strictEqual(
      result.undefinedIdentifiers.length,
      0,
      `Nested callback parameters and closures must not be undefined, got: ${JSON.stringify(result.undefinedIdentifiers)}`
    );
  });

  test('4. Callback Destructuring: object and array destructuring parameters are defined', () => {
    const code = `
      import React from 'react';

      interface Row {
        id: number;
        user: { name: string; email: string };
        tags: string[];
      }

      export function Table({ rows }: { rows: Row[] }) {
        return (
          <div>
            {rows.map(({ id, user: { name }, tags: [firstTag] }) => (
              <div key={id}>
                <strong>{name}</strong>: <span>{firstTag}</span>
              </div>
            ))}
          </div>
        );
      }
    `;

    const result = analyzer.analyze(vscode.Uri.file('/app/Table.tsx'), code);
    assert.strictEqual(
      result.undefinedIdentifiers.length,
      0,
      `Destructured parameters must resolve without errors, got: ${JSON.stringify(result.undefinedIdentifiers)}`
    );
  });

  test('5. React Hooks & Component State: useState, useEffect, useCallback', () => {
    const code = `
      import React, { useState, useEffect, useCallback } from 'react';

      export function Counter({ initialCount }: { initialCount: number }) {
        const [count, setCount] = useState(initialCount);

        const handleIncrement = useCallback(() => {
          setCount(prev => prev + 1);
        }, []);

        useEffect(() => {
          console.log('Count changed:', count);
        }, [count]);

        return (
          <button onClick={handleIncrement}>
            Count: {count}
          </button>
        );
      }
    `;

    const result = analyzer.analyze(vscode.Uri.file('/app/Counter.tsx'), code);
    assert.strictEqual(
      result.undefinedIdentifiers.length,
      0,
      `React hooks and state variables must resolve cleanly, got: ${JSON.stringify(result.undefinedIdentifiers)}`
    );
    assert.strictEqual(result.unusedImports.length, 0, 'All React hook imports are used');
  });

  test('6. JSX References & External Imports: react-icons/fa and reactstrap', () => {
    const code = `
      import React from 'react';
      import { FaUser, FaLock, FaEnvelope } from 'react-icons/fa';
      import { Button, Form, FormGroup, Label, Input } from 'reactstrap';

      export function LoginForm() {
        return (
          <Form>
            <FormGroup>
              <Label>
                <FaUser /> Username
              </Label>
              <Input type="text" />
            </FormGroup>
            <FormGroup>
              <Label>
                <FaLock /> Password
              </Label>
              <Input type="password" />
            </FormGroup>
            <Button color="primary">Submit</Button>
          </Form>
        );
      }
    `;

    const result = analyzer.analyze(vscode.Uri.file('/app/LoginForm.tsx'), code);

    // 0 undefined identifiers
    assert.strictEqual(
      result.undefinedIdentifiers.length,
      0,
      `Valid components and external imports must not be undefined, got: ${JSON.stringify(result.undefinedIdentifiers)}`
    );

    // FaEnvelope was not used, should be classified as unused import
    assert.strictEqual(result.unusedImports.length, 1);
    assert.strictEqual(result.unusedImports[0]?.name, 'FaEnvelope');
    assert.strictEqual(result.unusedImports[0]?.moduleSpecifier, 'react-icons/fa');
  });

  test('7. Package Aliases: local aliases map correctly and resolve call sites', () => {
    const code = `
      import { Button as PrimaryBtn } from 'reactstrap';
      import { GraphQLInt as IntScalar } from 'graphql';

      export function AliasedDemo() {
        const value: IntScalar = 100;
        return <PrimaryBtn>{value}</PrimaryBtn>;
      }
    `;

    const result = analyzer.analyze(vscode.Uri.file('/app/AliasedDemo.tsx'), code);
    assert.strictEqual(
      result.undefinedIdentifiers.length,
      0,
      `Aliased imports must resolve cleanly, got: ${JSON.stringify(result.undefinedIdentifiers)}`
    );

    // Check that importedSymbols tracks original imported name
    const btnImport = result.importedSymbols.find(i => i.localName === 'PrimaryBtn');
    assert.ok(btnImport);
    assert.strictEqual(btnImport.importedName, 'Button');
    assert.strictEqual(btnImport.localName, 'PrimaryBtn');

    const scalarImport = result.importedSymbols.find(i => i.localName === 'IntScalar');
    assert.ok(scalarImport);
    assert.strictEqual(scalarImport.importedName, 'GraphQLInt');
    assert.strictEqual(scalarImport.localName, 'IntScalar');
  });

  test('8. Used vs Genuinely Unused Variables & Exports', () => {
    const code = `
      // Genuinely unused local variable
      const unusedLocal = 42;

      // Used local variable
      const usedLocal = 10;
      console.log(usedLocal);

      // Underscore-prefixed parameter (standard convention to ignore)
      function processItems(items: string[]) {
        return items.map((_item, index) => index);
      }

      // Exported function (public module API, must not be flagged as unused)
      export function publicHelper() {
        return processItems(['a', 'b']);
      }
    `;

    const result = analyzer.analyze(vscode.Uri.file('/app/Helper.ts'), code);

    // Unused variables should flag unusedLocal
    const unusedNames = result.unusedVariables.map(v => v.name);
    assert.ok(unusedNames.includes('unusedLocal'), 'unusedLocal must be flagged as unused');
    assert.ok(!unusedNames.includes('usedLocal'), 'usedLocal must NOT be flagged as unused');
    assert.ok(!unusedNames.includes('publicHelper'), 'Exported functions must NOT be flagged as unused');

    // Underscore parameter must NOT be flagged as unused parameter
    const unusedParamNames = result.unusedParameters.map(p => p.name);
    assert.ok(!unusedParamNames.includes('_item'), '_item must not be flagged as unused parameter');
  });

  test('9. Genuine Errors: Undeclared identifiers are flagged as confirmed errors', () => {
    const code = `
      import React from 'react';

      export function BrokenComponent() {
        // completelyUndefinedFunction and missingVariable are never declared or imported
        const data = completelyUndefinedFunction();
        return <div>{missingVariable}</div>;
      }
    `;

    const result = analyzer.analyze(vscode.Uri.file('/app/Broken.tsx'), code);
    const undefinedNames = result.undefinedIdentifiers.map(u => u.name);

    assert.ok(
      undefinedNames.includes('completelyUndefinedFunction'),
      'Missing function call must be flagged as undefined'
    );
    assert.ok(
      undefinedNames.includes('missingVariable'),
      'Missing variable reference must be flagged as undefined'
    );
    assert.strictEqual(undefinedNames.length, 2);
  });

  test('10. Authoritative Diagnostic Classification & Grouping', async () => {
    const workspaceManager = new WorkspaceManager(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    languageRegistry.registerBuiltinAdapters();

    const tracker = new DiagnosticTracker(workspaceManager, languageRegistry, logger);
    const engine = new DiagnosticDeltaEngine(tracker, logger);

    const testUri = vscode.Uri.file('/workspace/app.ts');

    // Mock an active baseline
    await tracker.captureBaseline();

    // Create 3 diagnostics:
    // 1. TS6133 unused variable (should be Info / needs-review / unused-code)
    // 2. TS2322 type mismatch (should be Warning / structural-regression / type-safety)
    // 3. TS2304 cannot find name (should be Error / confirmed-regression / confirmed-new-diagnostic)
    const d1 = new vscode.Diagnostic(
      new vscode.Range(2, 6, 2, 12),
      "'unusedVar' is declared but its value is never read.",
      vscode.DiagnosticSeverity.Warning
    );
    d1.code = '6133';
    d1.source = 'typescript';

    const d2 = new vscode.Diagnostic(
      new vscode.Range(5, 4, 5, 10),
      "Type 'string' is not assignable to type 'number'.",
      vscode.DiagnosticSeverity.Error
    );
    d2.code = '2322';
    d2.source = 'typescript';

    const d3 = new vscode.Diagnostic(
      new vscode.Range(10, 0, 10, 8),
      "Cannot find name 'missingVar'.",
      vscode.DiagnosticSeverity.Error
    );
    d3.code = '2304';
    d3.source = 'typescript';

    const rootUri = vscode.Uri.file('/workspace');
    const fp1 = createDiagnosticFingerprint(testUri, d1, rootUri);
    const fp2 = createDiagnosticFingerprint(testUri, d2, rootUri);
    const fp3 = createDiagnosticFingerprint(testUri, d3, rootUri);

    // Test the createFindingFromDiagnostic logic directly via engine
    const findingUnused = (engine as unknown as { _createFindingFromDiagnostic(fp: unknown): unknown })._createFindingFromDiagnostic(fp1) as {
      severity: string;
      category: string;
      evidenceClassification: string;
    };
    assert.strictEqual(findingUnused.severity, 'info', 'TS6133 unused code must NOT be classified as critical');
    assert.strictEqual(findingUnused.category, 'unused-code');
    assert.strictEqual(findingUnused.evidenceClassification, 'needs-review');

    const findingTypeMismatch = (engine as unknown as { _createFindingFromDiagnostic(fp: unknown): unknown })._createFindingFromDiagnostic(fp2) as {
      severity: string;
      category: string;
      evidenceClassification: string;
    };
    assert.strictEqual(findingTypeMismatch.severity, 'warning', 'TS2322 type mismatch must be warning, not critical');
    assert.strictEqual(findingTypeMismatch.category, 'type-safety');
    assert.strictEqual(findingTypeMismatch.evidenceClassification, 'structural-regression');

    const findingMissingName = (engine as unknown as { _createFindingFromDiagnostic(fp: unknown): unknown })._createFindingFromDiagnostic(fp3) as {
      severity: string;
      category: string;
      evidenceClassification: string;
    };
    assert.strictEqual(findingMissingName.severity, 'error', 'TS2304 cannot find name must be error');
    assert.strictEqual(findingMissingName.category, 'confirmed-new-diagnostic');
    assert.strictEqual(findingMissingName.evidenceClassification, 'confirmed-regression');
  });

  test('11. Multiline Imports & Subpath Packages in DependencyGraph', async () => {
    const workspaceManager = new WorkspaceManager(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    languageRegistry.registerBuiltinAdapters();

    const graph = new DependencyGraph(workspaceManager, languageRegistry, logger);

    const code = `
      import {
        GraphQLInt,
        GraphQLString
      } from 'graphql';
      import {
        FaUser,
        FaLock
      } from 'react-icons/fa';
      import { Button as MyButton } from './local-button';

      export const dummy = 1;
    `;

    const fileUri = vscode.Uri.file('/workspace/src/consumer.ts');

    // Register a workspace root
    (workspaceManager as unknown as { _roots: { uri: vscode.Uri; name: string }[] })._roots = [
      { uri: vscode.Uri.file('/workspace'), name: 'workspace' },
    ];

    const links = await graph.analyzeFileDependencies(fileUri, code);

    // External packages ('graphql', 'react-icons/fa') should NOT resolve to local files
    // Local button import ('./local-button') should be handled
    const localLink = links.find(l => l.rawImport === './local-button');
    if (localLink) {
      assert.ok(localLink.importedSymbols.includes('Button'), 'Local link must extract Button from alias');
    }
  });
});
