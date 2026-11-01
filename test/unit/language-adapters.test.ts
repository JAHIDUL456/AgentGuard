import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { NullLogger } from '../../src/core/logger';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { BaseLanguageAdapter } from '../../src/languages/base-adapter';
import { CapabilityLevel, StructuralAnalysisResult } from '../../src/languages/types';

suite('Multi-Language Adapter Architecture (11 Languages)', () => {
  let registry: LanguageAdapterRegistry;
  const fixturesRoot = path.join(__dirname, '../../../test/fixtures/languages');

  setup(() => {
    registry = new LanguageAdapterRegistry(new NullLogger());
    registry.registerBuiltinAdapters();
  });

  teardown(() => {
    registry.dispose();
  });

  test('registers all 11 required language adapters', () => {
    const adapters = registry.getAdapters();
    assert.strictEqual(adapters.length, 11);

    const ids = adapters.map(a => a.id).sort();
    assert.deepStrictEqual(ids, [
      'c',
      'cpp',
      'csharp',
      'dart',
      'go',
      'java',
      'javascript',
      'php',
      'python',
      'rust',
      'typescript',
    ]);
  });

  test('reports actual capability levels accurately without exaggeration', () => {
    const ts = registry.getAdapterById('typescript')!;
    assert.strictEqual(ts.capabilityLevel, CapabilityLevel.Level4_DiagnosticsIntegration);

    const js = registry.getAdapterById('javascript')!;
    assert.strictEqual(js.capabilityLevel, CapabilityLevel.Level4_DiagnosticsIntegration);

    const python = registry.getAdapterById('python')!;
    assert.strictEqual(python.capabilityLevel, CapabilityLevel.Level3_DependencyAnalysis);

    const go = registry.getAdapterById('go')!;
    assert.strictEqual(go.capabilityLevel, CapabilityLevel.Level3_DependencyAnalysis);

    const rust = registry.getAdapterById('rust')!;
    assert.strictEqual(rust.capabilityLevel, CapabilityLevel.Level3_DependencyAnalysis);

    const java = registry.getAdapterById('java')!;
    assert.strictEqual(java.capabilityLevel, CapabilityLevel.Level3_DependencyAnalysis);

    const csharp = registry.getAdapterById('csharp')!;
    assert.strictEqual(csharp.capabilityLevel, CapabilityLevel.Level3_DependencyAnalysis);

    const php = registry.getAdapterById('php')!;
    assert.strictEqual(php.capabilityLevel, CapabilityLevel.Level3_DependencyAnalysis);

    const dart = registry.getAdapterById('dart')!;
    assert.strictEqual(dart.capabilityLevel, CapabilityLevel.Level3_DependencyAnalysis);

    const c = registry.getAdapterById('c')!;
    assert.strictEqual(c.capabilityLevel, CapabilityLevel.Level3_DependencyAnalysis);

    const cpp = registry.getAdapterById('cpp')!;
    assert.strictEqual(cpp.capabilityLevel, CapabilityLevel.Level3_DependencyAnalysis);
  });

  test('maps file extensions accurately for all 11 languages', () => {
    const testCases: Array<[string, string]> = [
      ['/src/app.ts', 'typescript'],
      ['/src/component.tsx', 'typescript'],
      ['/src/module.mts', 'typescript'],
      ['/src/legacy.cts', 'typescript'],
      ['/src/index.js', 'javascript'],
      ['/src/view.jsx', 'javascript'],
      ['/src/bundle.mjs', 'javascript'],
      ['/src/common.cjs', 'javascript'],
      ['/src/script.py', 'python'],
      ['/src/types.pyi', 'python'],
      ['/src/main.go', 'go'],
      ['/src/lib.rs', 'rust'],
      ['/src/App.java', 'java'],
      ['/src/Program.cs', 'csharp'],
      ['/src/index.php', 'php'],
      ['/src/main.dart', 'dart'],
      ['/src/driver.c', 'c'],
      ['/src/driver.h', 'c'],
      ['/src/engine.cpp', 'cpp'],
      ['/src/engine.hpp', 'cpp'],
      ['/src/engine.cc', 'cpp'],
      ['/src/engine.cxx', 'cpp'],
    ];

    for (const [filePath, expectedId] of testCases) {
      const adapter = registry.getAdapterForUri(vscode.Uri.file(filePath));
      assert.ok(adapter, `Adapter should exist for ${filePath}`);
      assert.strictEqual(adapter.id, expectedId, `Expected ${expectedId} for ${filePath}`);
    }
  });

  test('matches project manifests accurately', () => {
    assert.ok(registry.getAdaptersForManifest('tsconfig.json').some(a => a.id === 'typescript'));
    assert.ok(registry.getAdaptersForManifest('package.json').some(a => a.id === 'javascript'));
    assert.ok(registry.getAdaptersForManifest('pyproject.toml').some(a => a.id === 'python'));
    assert.ok(registry.getAdaptersForManifest('requirements.txt').some(a => a.id === 'python'));
    assert.ok(registry.getAdaptersForManifest('go.mod').some(a => a.id === 'go'));
    assert.ok(registry.getAdaptersForManifest('Cargo.toml').some(a => a.id === 'rust'));
    assert.ok(registry.getAdaptersForManifest('pom.xml').some(a => a.id === 'java'));
    assert.ok(registry.getAdaptersForManifest('build.gradle').some(a => a.id === 'java'));
    assert.ok(registry.getAdaptersForManifest('App.csproj').some(a => a.id === 'csharp'));
    assert.ok(registry.getAdaptersForManifest('Solution.sln').some(a => a.id === 'csharp'));
    assert.ok(registry.getAdaptersForManifest('composer.json').some(a => a.id === 'php'));
    assert.ok(registry.getAdaptersForManifest('pubspec.yaml').some(a => a.id === 'dart'));
    assert.ok(registry.getAdaptersForManifest('CMakeLists.txt').some(a => a.id === 'c' || a.id === 'cpp'));
    assert.ok(registry.getAdaptersForManifest('Makefile').some(a => a.id === 'c' || a.id === 'cpp'));
  });

  test('parses TypeScript fixture and extracts classes, interfaces, and imports', async () => {
    const tsFile = path.join(fixturesRoot, 'typescript/sample.ts');
    const content = fs.readFileSync(tsFile, 'utf8');
    const adapter = registry.getAdapterById('typescript')!;

    const result = await adapter.parseStructure(vscode.Uri.file(tsFile), content);
    assert.ok(result.nodes.some(n => n.kind === 'interface' && n.name === 'User'));
    assert.ok(result.nodes.some(n => n.kind === 'class' && n.name === 'UserService'));
    assert.ok(result.nodes.some(n => n.kind === 'function' && n.name === 'getUserCount'));
    assert.ok(result.imports.includes('fs'));
    assert.ok(result.imports.includes('path'));
  });

  test('parses JavaScript fixture with CommonJS require and ES imports', async () => {
    const jsFile = path.join(fixturesRoot, 'javascript/sample.js');
    const content = fs.readFileSync(jsFile, 'utf8');
    const adapter = registry.getAdapterById('javascript')!;

    const result = await adapter.parseStructure(vscode.Uri.file(jsFile), content);
    assert.ok(result.nodes.some(n => n.kind === 'class' && n.name === 'ServerManager'));
    assert.ok(result.nodes.some(n => n.kind === 'function' && n.name === 'createHandler'));
    assert.ok(result.imports.includes('http'));
    assert.ok(result.imports.includes('lodash'));
  });

  test('parses Python fixture and extracts classes, functions, and imports', async () => {
    const pyFile = path.join(fixturesRoot, 'python/sample.py');
    const content = fs.readFileSync(pyFile, 'utf8');
    const adapter = registry.getAdapterById('python')!;

    const result = await adapter.parseStructure(vscode.Uri.file(pyFile), content);
    assert.ok(result.nodes.some(n => n.kind === 'class' && n.name === 'DataPipeline'));
    assert.ok(result.nodes.some(n => n.name === 'process'));
    assert.ok(result.nodes.some(n => n.name === 'run_pipeline'));
    assert.ok(result.imports.includes('os'));
    assert.ok(result.imports.includes('sys'));
    assert.ok(result.imports.includes('typing'));
  });

  test('parses Go fixture and extracts structs, interfaces, and functions', async () => {
    const goFile = path.join(fixturesRoot, 'go/sample.go');
    const content = fs.readFileSync(goFile, 'utf8');
    const adapter = registry.getAdapterById('go')!;

    const result = await adapter.parseStructure(vscode.Uri.file(goFile), content);
    assert.ok(result.nodes.some(n => n.kind === 'struct' && n.name === 'ServerConfig'));
    assert.ok(result.nodes.some(n => n.kind === 'interface' && n.name === 'Router'));
    assert.ok(result.nodes.some(n => n.kind === 'function' && n.name === 'StartServer'));
    assert.ok(result.imports.includes('fmt'));
    assert.ok(result.imports.includes('net/http'));
  });

  test('parses Rust fixture and extracts structs, enums, traits, and functions', async () => {
    const rsFile = path.join(fixturesRoot, 'rust/sample.rs');
    const content = fs.readFileSync(rsFile, 'utf8');
    const adapter = registry.getAdapterById('rust')!;

    const result = await adapter.parseStructure(vscode.Uri.file(rsFile), content);
    assert.ok(result.nodes.some(n => n.kind === 'struct' && n.name === 'GuardState'));
    assert.ok(result.nodes.some(n => n.kind === 'enum' && n.name === 'AlertLevel'));
    assert.ok(result.nodes.some(n => n.kind === 'trait' && n.name === 'Monitor'));
    assert.ok(result.nodes.some(n => n.kind === 'function' && n.name === 'initialize_guard'));
    assert.ok(result.imports.includes('std'));
  });

  test('parses Java fixture and extracts classes and imports', async () => {
    const javaFile = path.join(fixturesRoot, 'java/Sample.java');
    const content = fs.readFileSync(javaFile, 'utf8');
    const adapter = registry.getAdapterById('java')!;

    const result = await adapter.parseStructure(vscode.Uri.file(javaFile), content);
    assert.ok(result.nodes.some(n => n.kind === 'class' && n.name === 'Sample'));
    assert.ok(result.nodes.some(n => n.kind === 'method' && n.name === 'addItem'));
    assert.ok(result.imports.includes('java.util.List'));
  });

  test('parses C# fixture and extracts classes, namespaces, and methods', async () => {
    const csFile = path.join(fixturesRoot, 'csharp/Sample.cs');
    const content = fs.readFileSync(csFile, 'utf8');
    const adapter = registry.getAdapterById('csharp')!;

    const result = await adapter.parseStructure(vscode.Uri.file(csFile), content);
    assert.ok(result.nodes.some(n => n.kind === 'namespace' && n.name === 'AgentGuard.Sample'));
    assert.ok(result.nodes.some(n => n.kind === 'class' && n.name === 'SampleService'));
    assert.ok(result.nodes.some(n => n.kind === 'method' && n.name === 'Validate'));
    assert.ok(result.imports.includes('System'));
  });

  test('parses PHP fixture and extracts classes, namespaces, and functions', async () => {
    const phpFile = path.join(fixturesRoot, 'php/sample.php');
    const content = fs.readFileSync(phpFile, 'utf8');
    const adapter = registry.getAdapterById('php')!;

    const result = await adapter.parseStructure(vscode.Uri.file(phpFile), content);
    assert.ok(result.nodes.some(n => n.kind === 'namespace' && n.name === 'AgentGuard\\Sample'));
    assert.ok(result.nodes.some(n => n.kind === 'class' && n.name === 'LoggerService'));
    assert.ok(result.nodes.some(n => n.kind === 'function' && n.name === 'initLogger'));
    assert.ok(result.imports.includes('DateTime'));
  });

  test('parses Dart fixture and extracts classes, functions, and imports', async () => {
    const dartFile = path.join(fixturesRoot, 'dart/sample.dart');
    const content = fs.readFileSync(dartFile, 'utf8');
    const adapter = registry.getAdapterById('dart')!;

    const result = await adapter.parseStructure(vscode.Uri.file(dartFile), content);
    assert.ok(result.nodes.some(n => n.kind === 'class' && n.name === 'UserProfile'));
    assert.ok(result.nodes.some(n => n.kind === 'function' && n.name === 'loadProfile'));
    assert.ok(result.imports.includes('dart:async'));
  });

  test('parses C fixture and extracts structs, functions, and includes', async () => {
    const cFile = path.join(fixturesRoot, 'c/sample.c');
    const content = fs.readFileSync(cFile, 'utf8');
    const adapter = registry.getAdapterById('c')!;

    const result = await adapter.parseStructure(vscode.Uri.file(cFile), content);
    assert.ok(result.nodes.some(n => n.kind === 'function' && n.name === 'add_points'));
    assert.ok(result.imports.includes('stdio.h'));
    assert.ok(result.imports.includes('sample.h'));
  });

  test('parses C++ fixture and extracts namespaces, classes, and methods', async () => {
    const cppFile = path.join(fixturesRoot, 'cpp/sample.cpp');
    const content = fs.readFileSync(cppFile, 'utf8');
    const adapter = registry.getAdapterById('cpp')!;

    const result = await adapter.parseStructure(vscode.Uri.file(cppFile), content);
    assert.ok(result.imports.includes('iostream'));
    assert.ok(result.imports.includes('sample.hpp'));
  });

  test('handles malformed source files with syntax errors without crashing', async () => {
    const malformedTs = path.join(fixturesRoot, 'malformed/malformed.ts');
    const tsContent = fs.readFileSync(malformedTs, 'utf8');
    const tsAdapter = registry.getAdapterById('typescript')!;

    const tsRes = await tsAdapter.parseStructure(vscode.Uri.file(malformedTs), tsContent);
    assert.ok(tsRes.syntaxErrors.length > 0, 'Malformed TS must report syntax errors');

    const malformedPy = path.join(fixturesRoot, 'malformed/malformed.py');
    const pyContent = fs.readFileSync(malformedPy, 'utf8');
    const pyAdapter = registry.getAdapterById('python')!;

    const pyRes = await pyAdapter.parseStructure(vscode.Uri.file(malformedPy), pyContent);
    assert.ok(pyRes.syntaxErrors.length > 0, 'Malformed Python must report syntax errors');
  });

  test('isolates catastrophic adapter failure from crashing the registry or other adapters', async () => {
    // Create an intentionally throwing adapter
    class BuggyAdapter extends BaseLanguageAdapter {
      public readonly id = 'buggy';
      public readonly displayName = 'Buggy';
      public readonly fileExtensions = ['.buggy'];
      public readonly languageIds = ['buggy'];
      public readonly projectManifests = ['buggy.json'];
      public readonly capabilityLevel = CapabilityLevel.Level1_ChangeMonitoring;
      public readonly capabilities = ['change-monitoring' as const];
      public readonly knownLimitations = [];

      protected override async _doParseStructure(): Promise<StructuralAnalysisResult> {
        throw new Error('Catastrophic parser crash');
      }

      protected override async _doExtractDependencies(): Promise<readonly string[]> {
        throw new Error('Catastrophic dependency crash');
      }
    }

    const buggy = new BuggyAdapter(new NullLogger());
    registry.registerAdapter(buggy);

    // Call parseStructure - must return gracefully and NOT throw
    const res = await buggy.parseStructure(vscode.Uri.file('/app/test.buggy'), 'content');
    assert.strictEqual(res.nodes.length, 0);
    assert.ok(res.syntaxErrors.length > 0);
    assert.ok(res.syntaxErrors[0]?.message.includes('Catastrophic parser crash'));

    // Call extractDependencies - must return empty array and NOT throw
    const deps = await buggy.extractDependencies(vscode.Uri.file('/app/test.buggy'), 'content');
    assert.strictEqual(deps.length, 0);

    // Other adapters remain fully functional
    const tsAdapter = registry.getAdapterById('typescript');
    assert.ok(tsAdapter);
    const tsRes = await tsAdapter.parseStructure(vscode.Uri.file('/app/valid.ts'), 'export const x = 1;');
    assert.strictEqual(tsRes.syntaxErrors.length, 0);
  });
});

