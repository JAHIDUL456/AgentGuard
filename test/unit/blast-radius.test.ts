import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BlastRadiusEngine } from '../../src/analysis/blast-radius/blast-radius-engine';
import { DependencyGraph } from '../../src/analysis/blast-radius/dependency-graph';
import { StructuralDiffer } from '../../src/analysis/blast-radius/structural-differ';
import { DiagnosticTracker } from '../../src/analysis/diagnostics/diagnostic-tracker';
import { NullLogger } from '../../src/core/logger';
import { GitService } from '../../src/git/git-service';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { StructuralNode } from '../../src/languages/types';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';

suite('Untouched File Blast-Radius Analysis Engine', () => {
  const logger = new NullLogger();

  test('StructuralDiffer detects deleted, renamed, signature-changed, and added symbols', () => {
    const differ = new StructuralDiffer();

    const previousNodes: StructuralNode[] = [
      {
        kind: 'function',
        name: 'calculateTax',
        startLine: 10,
        endLine: 20,
        details: 'calculateTax(income: number): number',
      },
      {
        kind: 'function',
        name: 'validateUser',
        startLine: 25,
        endLine: 35,
        details: 'validateUser(user: User): boolean',
      },
      {
        kind: 'class',
        name: 'SessionService',
        startLine: 40,
        endLine: 60,
        details: 'class SessionService',
      },
    ];

    const currentNodes: StructuralNode[] = [
      // 1. Signature changed on calculateTax (extra rate param)
      {
        kind: 'function',
        name: 'calculateTax',
        startLine: 10,
        endLine: 22,
        details: 'calculateTax(income: number, rate: number): number',
      },
      // 2. validateUser renamed to verifyUser at line 25
      {
        kind: 'function',
        name: 'verifyUser',
        startLine: 26,
        endLine: 36,
        details: 'verifyUser(user: User): boolean',
      },
      // SessionService deleted
      // 3. New function added
      {
        kind: 'function',
        name: 'generateToken',
        startLine: 70,
        endLine: 80,
        details: 'generateToken(): string',
      },
    ];

    const changes = differ.diffNodes(previousNodes, currentNodes);

    const sigChange = changes.find(c => c.changeKind === 'signature-changed');
    assert.ok(sigChange, 'Should detect signature change on calculateTax');
    assert.strictEqual(sigChange.name, 'calculateTax');

    const renameChange = changes.find(c => c.changeKind === 'renamed');
    assert.ok(renameChange, 'Should detect rename from validateUser to verifyUser');
    assert.strictEqual(renameChange.name, 'validateUser');

    const deleteChange = changes.find(c => c.changeKind === 'deleted');
    assert.ok(deleteChange, 'Should detect deletion of SessionService');
    assert.strictEqual(deleteChange.name, 'SessionService');

    const addChange = changes.find(c => c.changeKind === 'added');
    assert.ok(addChange, 'Should detect addition of generateToken');
    assert.strictEqual(addChange.name, 'generateToken');
  });

  test('DependencyGraph rejects raw keyword/substring matches and only links valid imports', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-graph-test-'));

    try {
      const rootUri = vscode.Uri.file(tempDir);
      (vscode.workspace as any).workspaceFolders = [
        { uri: rootUri, name: 'Root', index: 0 },
      ];
      const workspaceManager = new WorkspaceManager(logger);
      const languageRegistry = new LanguageAdapterRegistry(logger);
      languageRegistry.registerBuiltinAdapters();

      // Provider file: src/auth.ts
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      const authFile = path.join(srcDir, 'auth.ts');
      fs.writeFileSync(authFile, 'export function login() {}\n');

      // Valid consumer: src/controller.ts
      const controllerFile = path.join(srcDir, 'controller.ts');
      fs.writeFileSync(
        controllerFile,
        "import { login } from './auth';\nlogin();\n"
      );

      // Unrelated file with textual keyword matches: src/unrelated.ts
      // Mentions 'auth' and 'login' in comments and strings but has NO import statement
      const unrelatedFile = path.join(srcDir, 'unrelated.ts');
      fs.writeFileSync(
        unrelatedFile,
        "// We should authenticate user login here eventually\nconst authUrl = '/auth/login';\n"
      );

      const graph = new DependencyGraph(workspaceManager, languageRegistry, logger);

      // Index controller
      await graph.analyzeFileDependencies(vscode.Uri.file(controllerFile));
      // Index unrelated
      await graph.analyzeFileDependencies(vscode.Uri.file(unrelatedFile));

      const dependents = await graph.findDependents(vscode.Uri.file(authFile));

      assert.strictEqual(
        dependents.length,
        1,
        'Only controller.ts should be linked as a dependent'
      );
      assert.strictEqual(
        dependents[0]!.consumerUri.fsPath,
        controllerFile
      );
      assert.deepStrictEqual(dependents[0]!.importedSymbols, ['login']);

      // Unrelated file MUST NOT be present
      const unrelatedDependent = dependents.find(
        d => d.consumerUri.fsPath === unrelatedFile
      );
      assert.strictEqual(
        unrelatedDependent,
        undefined,
        'Raw substring match in unrelated.ts must not create a false dependency link'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('DependencyGraph detects dynamic imports and flags them appropriately', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-dynamic-test-'));

    try {
      const rootUri = vscode.Uri.file(tempDir);
      (vscode.workspace as any).workspaceFolders = [
        { uri: rootUri, name: 'Root', index: 0 },
      ];
      const workspaceManager = new WorkspaceManager(logger);
      const languageRegistry = new LanguageAdapterRegistry(logger);
      languageRegistry.registerBuiltinAdapters();

      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'plugin.ts');
      fs.writeFileSync(targetFile, 'export function run() {}\n');

      const loaderFile = path.join(srcDir, 'loader.ts');
      fs.writeFileSync(
        loaderFile,
        "const path = './plugin';\nconst mod = require(`${path}`);\n"
      );

      const graph = new DependencyGraph(workspaceManager, languageRegistry, logger);
      const links = await graph.analyzeFileDependencies(vscode.Uri.file(loaderFile));

      const dynamicLink = links.find(l => l.isDynamic);
      assert.ok(dynamicLink, 'Should flag dynamic import expression');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('BlastRadiusEngine produces high-confidence findings when provider deletes a symbol used in untouched file', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-blast-test-'));

    try {
      const rootUri = vscode.Uri.file(tempDir);
      (vscode.workspace as any).workspaceFolders = [
        { uri: rootUri, name: 'Root', index: 0 },
      ];
      const workspaceManager = new WorkspaceManager(logger);
      const languageRegistry = new LanguageAdapterRegistry(logger);
      languageRegistry.registerBuiltinAdapters();

      const gitService = new GitService(logger);
      const tracker = new DiagnosticTracker(workspaceManager, languageRegistry, logger);

      const engine = new BlastRadiusEngine(
        workspaceManager,
        languageRegistry,
        tracker,
        gitService,
        logger
      );

      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // Provider file: auth.ts
      const authFile = path.join(srcDir, 'auth.ts');
      const authUri = vscode.Uri.file(authFile);

      // Untouched consumer: service.ts
      const serviceFile = path.join(srcDir, 'service.ts');
      const serviceUri = vscode.Uri.file(serviceFile);
      fs.writeFileSync(
        serviceFile,
        "import { checkPermissions } from './auth';\n\nexport function run() { checkPermissions(); }\n"
      );

      // Previous AST for auth.ts had checkPermissions
      const previousAuthNodes: StructuralNode[] = [
        {
          kind: 'function',
          name: 'checkPermissions',
          startLine: 1,
          endLine: 5,
          details: 'checkPermissions(): void',
        },
      ];
      engine.seedAstCache(authUri, previousAuthNodes);

      // Now auth.ts is modified: checkPermissions was DELETED
      fs.writeFileSync(authFile, 'export function newAuthMethod() {}\n');

      // Pre-seed dependency graph
      await engine.dependencyGraph.analyzeFileDependencies(serviceUri);

      // Run blast radius scan with auth.ts as target
      const findings = await engine.analyze({
        workspaceRoots: workspaceManager.getRoots(),
        targetUris: [authUri],
      });

      assert.strictEqual(findings.length, 1);
      const f = findings[0]!;
      assert.strictEqual(f.category, 'potentially-broken-contract');
      assert.strictEqual(f.severity, 'error');
      assert.strictEqual(f.confidence, 'high');
      assert.ok(f.title.includes('checkPermissions'));
      assert.ok(f.evidence.includes('deleted in provider'));
      assert.ok(f.evidence.includes('service.ts'));
      assert.ok(f.explanation.toLowerCase().includes('downstream consuming files'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('BlastRadiusEngine detects signature changes affecting untouched consumers', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-sig-test-'));

    try {
      const rootUri = vscode.Uri.file(tempDir);
      (vscode.workspace as any).workspaceFolders = [
        { uri: rootUri, name: 'Root', index: 0 },
      ];
      const workspaceManager = new WorkspaceManager(logger);
      const languageRegistry = new LanguageAdapterRegistry(logger);
      languageRegistry.registerBuiltinAdapters();

      const gitService = new GitService(logger);
      const tracker = new DiagnosticTracker(workspaceManager, languageRegistry, logger);

      const engine = new BlastRadiusEngine(
        workspaceManager,
        languageRegistry,
        tracker,
        gitService,
        logger
      );

      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const dbFile = path.join(srcDir, 'db.ts');
      const dbUri = vscode.Uri.file(dbFile);

      const repoFile = path.join(srcDir, 'user-repo.ts');
      const repoUri = vscode.Uri.file(repoFile);
      fs.writeFileSync(
        repoFile,
        "import { query } from './db';\nexport function getUser() { query('users'); }\n"
      );

      // Previous AST for db.ts
      const previousDbNodes: StructuralNode[] = [
        {
          kind: 'function',
          name: 'query',
          startLine: 1,
          endLine: 4,
          details: 'query(table: string): Promise<any>',
        },
      ];
      engine.seedAstCache(dbUri, previousDbNodes);

      // Modified db.ts: query now requires 2 parameters: (table: string, timeout: number)
      fs.writeFileSync(
        dbFile,
        'export function query(table: string, timeout: number): Promise<any> { return Promise.resolve(); }\n'
      );

      await engine.dependencyGraph.analyzeFileDependencies(repoUri);

      const findings = await engine.analyze({
        workspaceRoots: workspaceManager.getRoots(),
        targetUris: [dbUri],
      });

      assert.strictEqual(findings.length, 1);
      const f = findings[0]!;
      assert.strictEqual(f.category, 'potentially-broken-contract');
      assert.strictEqual(f.confidence, 'high');
      assert.ok(f.title.includes('Signature Changed'));
      assert.ok(f.evidence.includes('Signature changed'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
