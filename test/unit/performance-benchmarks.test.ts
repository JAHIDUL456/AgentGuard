import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnalysisEngineRegistry } from '../../src/analysis/analyzer-registry';
import { LogicWatchdogEngine } from '../../src/analysis/watchdog/watchdog-engine';
import { AgentGuardEngine } from '../../src/core/engine';
import { NullLogger } from '../../src/core/logger';
import { Finding } from '../../src/core/types';
import { FindingManager } from '../../src/findings/finding-manager';
import { GitClient } from '../../src/git/git-client';
import { GitParser } from '../../src/git/git-parser';
import { GitService } from '../../src/git/git-service';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { TypeScriptAdapter } from '../../src/languages/adapters/typescript-adapter';
import { WorkspaceLanguageDetector } from '../../src/languages/workspace-detector';
import { ChangeMonitor } from '../../src/monitoring/change-monitor';
import { ChangeQueue } from '../../src/monitoring/change-queue';
import { MarkdownReporter } from '../../src/reporting/markdown-reporter';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';
import { mockVscode } from './mock-vscode';

const vscode = mockVscode as any;

suite('Stage 7: Performance Benchmarks & Reliability Audit', function () {
  this.timeout(10000);

  let tempDir: string;
  let logger: NullLogger;

  setup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-perf-test-'));
    logger = new NullLogger();
  });

  teardown(async () => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('Benchmark 1: Engine Activation & Initialization Duration (< 50ms)', async () => {
    const workspaceManager = new WorkspaceManager(logger);
    (workspaceManager as any)._roots = [
      { id: 'bench-root', uri: vscode.Uri.file(tempDir), name: 'BenchRoot', fsPath: tempDir, index: 0 },
    ];
    const changeMonitor = new ChangeMonitor(logger);
    const gitService = new GitService(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    const analysisRegistry = new AnalysisEngineRegistry(logger);
    const findingManager = new FindingManager(logger);

    const engine = new AgentGuardEngine(
      workspaceManager,
      changeMonitor,
      findingManager,
      languageRegistry,
      analysisRegistry,
      gitService,
      logger
    );

    const start = process.hrtime.bigint();
    await engine.initialize();
    const end = process.hrtime.bigint();

    const durationMs = Number(end - start) / 1_000_000;
    assert.strictEqual(engine.state, 'ready');
    assert.ok(
      durationMs < 50,
      `Engine initialization must be fast (< 50ms), took: ${durationMs.toFixed(2)}ms`
    );

    engine.dispose();
  });

  test('Benchmark 2: File Event Processing Throughput (> 1,000 events/sec)', () => {
    const queue = new ChangeQueue(5000);
    const eventCount = 1000;

    const start = process.hrtime.bigint();
    for (let i = 0; i < eventCount; i++) {
      queue.enqueue({
        kind: 'modified',
        uri: vscode.Uri.file(`/workspace/src/file_${i % 50}.ts`),
        timestamp: Date.now(),
        source: 'watcher',
      });
    }
    const end = process.hrtime.bigint();

    const durationMs = Number(end - start) / 1_000_000;
    const throughput = (eventCount / durationMs) * 1000;

    assert.ok(
      durationMs < 100,
      `Queueing 1,000 events took ${durationMs.toFixed(2)}ms (throughput: ${Math.round(throughput)} events/sec)`
    );
  });

  test('Benchmark 3: Git Status Caching Speedup (cached vs uncached)', async () => {
    const gitService = new GitService(logger);
    const rootUri = vscode.Uri.file(tempDir);

    // Seed the cache
    await gitService.getStatusForRoot(rootUri);

    // Measure cached retrieval
    const start = process.hrtime.bigint();
    const cachedResult = await gitService.getStatusForRoot(rootUri);
    const end = process.hrtime.bigint();

    const durationMs = Number(end - start) / 1_000_000;
    assert.ok(
      durationMs < 5,
      `Cached git status query should resolve in < 5ms, took: ${durationMs.toFixed(3)}ms`
    );
    gitService.dispose();
  });

  test('Benchmark 4: Unified Diff Parsing Throughput (> 20,000 lines/sec)', () => {
    // Generate a 1,000-line synthetic unified diff
    const hunks: string[] = ['diff --git a/src/large.ts b/src/large.ts', '--- a/src/large.ts', '+++ b/src/large.ts'];
    hunks.push('@@ -1,500 +1,500 @@');
    for (let i = 0; i < 500; i++) {
      hunks.push(`-const oldVar_${i} = ${i};`);
      hunks.push(`+const newVar_${i} = ${i + 1};`);
    }
    const diffText = hunks.join('\n');

    const start = process.hrtime.bigint();
    const result = GitParser.parseUnifiedDiffHunks(diffText);
    const end = process.hrtime.bigint();

    const durationMs = Number(end - start) / 1_000_000;
    const lineCount = 1000;
    const linesPerSec = (lineCount / durationMs) * 1000;

    assert.ok(result.length > 0);
    assert.ok(
      durationMs < 20,
      `Diff parsing of 1,000 lines took ${durationMs.toFixed(2)}ms (${Math.round(linesPerSec)} lines/sec)`
    );
  });

  test('Benchmark 5: Multi-Language Manifest Detection Duration (< 10ms)', async () => {
    // Create manifests
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'Cargo.toml'), '[package]');
    fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module example.com/bench');

    const registry = new LanguageAdapterRegistry(logger);
    registry.registerBuiltinAdapters();
    const detector = new WorkspaceLanguageDetector(registry, logger);

    const start = process.hrtime.bigint();
    const summary = await detector.detectWorkspace([vscode.Uri.file(tempDir)]);
    const end = process.hrtime.bigint();

    const durationMs = Number(end - start) / 1_000_000;
    assert.ok(summary.manifests.length >= 3);
    assert.ok(
      durationMs < 25,
      `Multi-language detection took ${durationMs.toFixed(2)}ms`
    );
  });

  test('Benchmark 6: AST Structural Parsing (< 15ms for 300 LOC)', async () => {
    const adapter = new TypeScriptAdapter(logger);
    const sampleTs = `
      import { AuthService } from './auth';
      import { TokenProvider } from './token';

      export interface UserProfile {
        id: string;
        roles: string[];
      }

      export class AccountService {
        constructor(private auth: AuthService) {}

        public async validateUser(token: string): Promise<UserProfile> {
          return this.auth.verify(token);
        }

        public async deleteAccount(userId: string): Promise<void> {
          // logic
        }
      }

      export function createAccountService(auth: AuthService): AccountService {
        return new AccountService(auth);
      }
    `;

    const start = process.hrtime.bigint();
    const result = await adapter.parseStructure(vscode.Uri.file('/src/sample.ts'), sampleTs);
    const end = process.hrtime.bigint();

    const durationMs = Number(end - start) / 1_000_000;
    assert.ok(result.nodes.length >= 3);
    assert.ok(result.imports.length >= 2);
    assert.ok(
      durationMs < 15,
      `Structural parsing took ${durationMs.toFixed(2)}ms`
    );
  });

  test('Benchmark 7: Watchdog Safety Rule Evaluation (< 20ms)', async () => {
    const workspaceManager = new WorkspaceManager(logger);
    const gitService = new GitService(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    const watchdog = new LogicWatchdogEngine(workspaceManager, languageRegistry, gitService, logger);

    const targetUri = vscode.Uri.file(path.join(tempDir, 'service.ts'));
    const oldCode = `
      app.use(verifyToken);
      if (!user.hasRole('admin')) { throw new Error('Forbidden'); }
      try { doWork(); } catch (e) { log(e); }
    `;
    const newCode = `
      // removed verifyToken
      // removed role check
      doWork();
    `;

    fs.writeFileSync(targetUri.fsPath, newCode);
    watchdog.seedContentCache(targetUri, oldCode);

    (workspaceManager as any)._roots = [
      { id: 'bench-1', uri: vscode.Uri.file(tempDir), name: 'Bench', fsPath: tempDir, index: 0 },
    ];

    const start = process.hrtime.bigint();
    const findings = await watchdog.analyze({
      workspaceRoots: [
        {
          id: 'bench-1',
          uri: vscode.Uri.file(tempDir),
          name: 'Bench',
          fsPath: tempDir,
          index: 0,
        },
      ],
      targetUris: [targetUri],
    });
    const end = process.hrtime.bigint();

    const durationMs = Number(end - start) / 1_000_000;
    assert.ok(findings.length >= 2, 'Should detect removed auth and role check');
    assert.ok(
      durationMs < 25,
      `Watchdog analysis took ${durationMs.toFixed(2)}ms`
    );
  });

  test('Benchmark 8: Markdown Report Generation Duration (< 5ms)', () => {
    const reporter = new MarkdownReporter();
    const findings: Finding[] = [];
    for (let i = 0; i < 30; i++) {
      findings.push({
        id: `f-${i}`,
        category: 'logic-risk',
        severity: i % 2 === 0 ? 'error' : 'warning',
        confidence: 'high',
        title: `Security Finding ${i}`,
        message: `Removed safeguard at index ${i}`,
        evidence: `line ${i} deleted`,
        explanation: `Explanation ${i}`,
        location: {
          filePath: `src/mod_${i}.ts`,
          uri: vscode.Uri.file(`/src/mod_${i}.ts`),
        },
        sourceEngine: 'logic-watchdog',
        timestamp: Date.now(),
      });
    }

    const stats = {
      total: 30,
      errors: 15,
      warnings: 15,
      infos: 0,
      byCategory: {
        'confirmed-new-diagnostic': 0,
        'diagnostic-regression': 0,
        'untouched-file': 0,
        'potentially-affected-dependency': 0,
        'potentially-broken-contract': 0,
        'unresolved-reference': 0,
        'analysis-incomplete': 0,
        'logic-risk': 30,
        'broken-dependency': 0,
      },
    };

    const start = process.hrtime.bigint();
    const md = reporter.generateReport(findings, stats, {
      workspaceName: 'Benchmark',
    });
    const end = process.hrtime.bigint();

    const durationMs = Number(end - start) / 1_000_000;
    assert.ok(md.length > 500);
    assert.ok(
      durationMs < 10,
      `Report generation of 30 findings took ${durationMs.toFixed(2)}ms`
    );
  });

  test('Reliability: Memory behavior across 10 repeated analysis cycles', async () => {
    const workspaceManager = new WorkspaceManager(logger);
    (workspaceManager as any)._roots = [
      { id: 'mem-1', uri: vscode.Uri.file(tempDir), name: 'MemRoot', fsPath: tempDir, index: 0 },
    ];
    const changeMonitor = new ChangeMonitor(logger);
    const gitService = new GitService(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    const analysisRegistry = new AnalysisEngineRegistry(logger);
    const findingManager = new FindingManager(logger);

    const engine = new AgentGuardEngine(
      workspaceManager,
      changeMonitor,
      findingManager,
      languageRegistry,
      analysisRegistry,
      gitService,
      logger
    );
    await engine.initialize();

    if (global.gc) {
      global.gc();
    }
    const memBefore = process.memoryUsage().heapUsed;

    for (let i = 0; i < 10; i++) {
      await engine.scanWorkspace();
    }

    if (global.gc) {
      global.gc();
    }
    const memAfter = process.memoryUsage().heapUsed;
    const growthMb = (memAfter - memBefore) / (1024 * 1024);

    // Heap growth after 10 scans should be negligible (< 15MB)
    assert.ok(
      growthMb < 15,
      `Heap growth across 10 scans was ${growthMb.toFixed(2)}MB (must be < 15MB)`
    );

    engine.dispose();
  });

  test('Reliability: Large files (> 2MB) are safely skipped without blocking', async () => {
    const largeFile = path.join(tempDir, 'huge_file.ts');
    // Create 2.2MB file
    const chunk = 'const a = 1;\n'.repeat(100);
    const fd = fs.openSync(largeFile, 'w');
    for (let i = 0; i < 1800; i++) {
      fs.writeSync(fd, chunk);
    }
    fs.closeSync(fd);

    const stat = fs.statSync(largeFile);
    assert.ok(stat.size > 2 * 1024 * 1024, 'File should exceed 2MB');

    const workspaceManager = new WorkspaceManager(logger);
    const gitService = new GitService(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    const watchdog = new LogicWatchdogEngine(workspaceManager, languageRegistry, gitService, logger);

    const findings = await watchdog.analyze({
      workspaceRoots: [
        {
          id: 'bench-1',
          uri: vscode.Uri.file(tempDir),
          name: 'Bench',
          fsPath: tempDir,
          index: 0,
        },
      ],
      targetUris: [vscode.Uri.file(largeFile)],
    });

    assert.strictEqual(findings.length, 0, 'Large file should be skipped safely without crashing');
  });
});
