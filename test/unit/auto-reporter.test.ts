import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnalysisEngineRegistry } from '../../src/analysis/analyzer-registry';
import { AgentGuardEngine } from '../../src/core/engine';
import { NullLogger } from '../../src/core/logger';
import { Finding } from '../../src/core/types';
import { FindingManager } from '../../src/findings/finding-manager';
import { GitService } from '../../src/git/git-service';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { TypeScriptAdapter } from '../../src/languages/adapters/typescript-adapter';
import { ChangeMonitor } from '../../src/monitoring/change-monitor';
import { FileFilter } from '../../src/monitoring/file-filter';
import { AutoReportManager } from '../../src/reporting/auto-reporter';
import { MarkdownReporter } from '../../src/reporting/markdown-reporter';
import { SecretSanitizer } from '../../src/reporting/report-sanitizer';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';
import { mockVscode } from './mock-vscode';

const vscode = mockVscode as any;

suite('Stage 7: Automatic Markdown Handoff & Safety Reports', () => {
  let tempDir: string;
  let logger: NullLogger;

  setup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-report-test-'));
    logger = new NullLogger();
  });

  teardown(async () => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('SecretSanitizer redacts credentials, keys, and tokens', () => {
    const rawEvidence =
      'const key = "AKIA1234567890ABCDEF"; const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"; const jwtToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.g5kL6Yt5d_x_1Q-2j4z";';
    const sanitized = SecretSanitizer.sanitize(rawEvidence);

    assert.ok(!sanitized.includes('AKIA1234567890ABCDEF'), 'Should redact AWS Key');
    assert.ok(sanitized.includes('[REDACTED_AWS_KEY]'));
    assert.ok(!sanitized.includes('ghp_1234567890abcdef'), 'Should redact GitHub PAT');
    assert.ok(sanitized.includes('[REDACTED_GITHUB_TOKEN]'));
    assert.ok(!sanitized.includes('eyJhbGciOiJIUzI1NiIsInR5cCI'), 'Should redact JWT');
    assert.ok(sanitized.includes('[REDACTED_JWT_TOKEN]'));
  });

  test('MarkdownReporter generates report containing required AI handoff and structure', () => {
    const reporter = new MarkdownReporter();
    const stats = {
      total: 1,
      errors: 1,
      warnings: 0,
      infos: 0,
      byCategory: {
        'confirmed-new-diagnostic': 1,
        'diagnostic-regression': 0,
        'untouched-file': 0,
        'potentially-affected-dependency': 0,
        'potentially-broken-contract': 0,
        'unresolved-reference': 0,
        'analysis-incomplete': 0,
        'logic-risk': 0,
        'broken-dependency': 0,
      },
    };

    const finding: Finding = {
      id: 'f-1',
      category: 'confirmed-new-diagnostic',
      severity: 'error',
      confidence: 'high',
      title: 'Type Regression',
      message: 'TS2304: Cannot find name authProvider',
      evidence: 'authProvider.verifyToken() removed from line 12',
      explanation: 'Compiler regression breaks compilation',
      location: {
        filePath: 'src/index.ts',
        uri: vscode.Uri.file('/repo/src/index.ts'),
      },
      sourceEngine: 'diagnostic-delta',
      timestamp: Date.now(),
    };

    const md = reporter.generateReport([finding], stats, {
      workspaceName: 'TestRepo',
      languages: [
        {
          id: 'typescript',
          name: 'TypeScript',
          level: 4,
          levelName: 'Diagnostics Integration',
          extensions: ['.ts', '.tsx'],
        },
      ],
      gitInfo: { available: true, repoCount: 1 },
    });

    // 1. AI Coding Agent Handoff Instruction
    assert.ok(
      md.includes('AI Coding Agent Handoff Instruction'),
      'Report must contain AI Coding Agent Handoff section'
    );
    assert.ok(
      md.includes(
        'Review this report. Investigate each finding. Fix confirmed errors. Inspect potential risks before changing code. Preserve existing application behavior. Run relevant tests after making changes.'
      ),
      'Report must contain the exact AI handoff instruction'
    );

    // 2. Report Sections
    assert.ok(md.includes('Workspace Information'), 'Should include Workspace Information');
    assert.ok(md.includes('Detected Languages & Analysis Capabilities'), 'Should include Languages');
    assert.ok(md.includes('Summary Overview'), 'Should include Summary Overview');
    assert.ok(md.includes('Detailed Findings'), 'Should include Detailed Findings');
    assert.ok(md.includes('Analysis Limitations & Boundaries'), 'Should include Limitations');
    assert.ok(md.includes('Recommended Next Actions'), 'Should include Recommended Actions');

    // 3. Finding Card
    assert.ok(md.includes('[ERROR] [HIGH CONFIDENCE] Type Regression'));
    assert.ok(md.includes('TS2304: Cannot find name authProvider'));
  });

  test('AutoReportManager automatically creates .vscode/agentguard-report.md on finding change', async () => {
    const workspaceUri = vscode.Uri.file(tempDir);
    const workspaceManager = new WorkspaceManager(logger);
    (workspaceManager as any)._roots = [
      { uri: workspaceUri, name: 'TestWorkspace', index: 0 },
    ];

    const changeMonitor = new ChangeMonitor(logger);
    const findingManager = new FindingManager(logger);
    const gitService = new GitService(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    languageRegistry.registerAdapter(new TypeScriptAdapter(logger));
    const analysisRegistry = new AnalysisEngineRegistry(logger);

    const engine = new AgentGuardEngine(
      workspaceManager,
      changeMonitor,
      findingManager,
      languageRegistry,
      analysisRegistry,
      gitService,
      logger
    );

    const reporter = new MarkdownReporter();
    const autoReporter = new AutoReportManager(
      engine,
      workspaceManager,
      findingManager,
      languageRegistry,
      reporter,
      logger,
      50 // fast debounce for test
    );

    // Add a finding to trigger report generation
    const finding: Finding = {
      id: 'f-auto-1',
      category: 'logic-risk',
      severity: 'error',
      confidence: 'high',
      title: 'Auth Guard Removed',
      message: 'Removed isAuthenticated middleware',
      evidence: 'app.use(isAuthenticated) deleted',
      explanation: 'Leaves endpoints unprotected',
      location: {
        filePath: 'src/server.ts',
        uri: vscode.Uri.file(path.join(tempDir, 'src/server.ts')),
      },
      sourceEngine: 'logic-watchdog',
      timestamp: Date.now(),
    };

    findingManager.addFinding(finding);

    // Wait for debounced write
    await new Promise(resolve => setTimeout(resolve, 150));

    const reportPath = path.join(tempDir, '.vscode', 'agentguard-report.md');
    assert.ok(fs.existsSync(reportPath), 'Report file should be automatically written');

    const content = fs.readFileSync(reportPath, 'utf8');
    assert.ok(content.includes('# AgentGuard Codebase Safety Report'));
    assert.ok(content.includes('Auth Guard Removed'));
    assert.ok(content.includes('AI Coding Agent Handoff Instruction'));

    // Check that temporary file was cleaned up (atomic write)
    const tempFile = path.join(tempDir, '.vscode', '.agentguard-report.tmp');
    assert.strictEqual(fs.existsSync(tempFile), false, 'Temp file should be renamed');

    autoReporter.dispose();
    findingManager.dispose();
  });

  test('AutoReportManager skips writing when content is unchanged', async () => {
    const workspaceUri = vscode.Uri.file(tempDir);
    const workspaceManager = new WorkspaceManager(logger);
    (workspaceManager as any)._roots = [
      { uri: workspaceUri, name: 'TestWorkspace', index: 0 },
    ];

    const changeMonitor = new ChangeMonitor(logger);
    const findingManager = new FindingManager(logger);
    const gitService = new GitService(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    const analysisRegistry = new AnalysisEngineRegistry(logger);
    const engine = new AgentGuardEngine(
      workspaceManager,
      changeMonitor,
      findingManager,
      languageRegistry,
      analysisRegistry,
      gitService,
      logger
    );
    const reporter = new MarkdownReporter();
    const autoReporter = new AutoReportManager(
      engine,
      workspaceManager,
      findingManager,
      languageRegistry,
      reporter,
      logger,
      10
    );

    await autoReporter.forceUpdate();

    const reportPath = path.join(tempDir, '.vscode', 'agentguard-report.md');
    assert.ok(fs.existsSync(reportPath));
    const mtime1 = fs.statSync(reportPath).mtimeMs;

    // Small delay and forceUpdate without finding changes
    await new Promise(resolve => setTimeout(resolve, 50));
    await autoReporter.forceUpdate();

    const mtime2 = fs.statSync(reportPath).mtimeMs;
    assert.strictEqual(
      mtime1,
      mtime2,
      'Report file should not be rewritten when content is unchanged'
    );

    autoReporter.dispose();
  });

  test('FileFilter prevents self-trigger loops on report files and temp files', () => {
    const reportPath = path.join(tempDir, '.vscode', 'agentguard-report.md');
    const tempPath = path.join(tempDir, '.vscode', '.agentguard-report.tmp');
    const normalSourcePath = path.join(tempDir, 'src', 'app.ts');

    assert.strictEqual(
      FileFilter.isAgentGuardReport(reportPath),
      true,
      'Report file must be identified as AgentGuard report'
    );
    assert.strictEqual(
      FileFilter.isAgentGuardReport(tempPath),
      true,
      'Report temp file must be identified as AgentGuard report'
    );
    assert.strictEqual(
      FileFilter.shouldIgnore(reportPath),
      true,
      'Report file must be ignored by monitoring'
    );
    assert.strictEqual(
      FileFilter.shouldIgnore(tempPath),
      true,
      'Report temp file must be ignored by monitoring'
    );
    assert.strictEqual(
      FileFilter.shouldIgnore(normalSourcePath),
      false,
      'Normal source file must not be ignored'
    );
  });

  test('AutoReportManager handles multi-root workspaces by generating report per root', async () => {
    const rootDirA = path.join(tempDir, 'repoA');
    const rootDirB = path.join(tempDir, 'repoB');
    fs.mkdirSync(rootDirA, { recursive: true });
    fs.mkdirSync(rootDirB, { recursive: true });

    const workspaceManager = new WorkspaceManager(logger);
    (workspaceManager as any)._roots = [
      { uri: vscode.Uri.file(rootDirA), name: 'RepoA', index: 0 },
      { uri: vscode.Uri.file(rootDirB), name: 'RepoB', index: 1 },
    ];

    const changeMonitor = new ChangeMonitor(logger);
    const findingManager = new FindingManager(logger);
    const gitService = new GitService(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    const analysisRegistry = new AnalysisEngineRegistry(logger);
    const engine = new AgentGuardEngine(
      workspaceManager,
      changeMonitor,
      findingManager,
      languageRegistry,
      analysisRegistry,
      gitService,
      logger
    );
    const reporter = new MarkdownReporter();
    const autoReporter = new AutoReportManager(
      engine,
      workspaceManager,
      findingManager,
      languageRegistry,
      reporter,
      logger,
      10
    );

    await autoReporter.forceUpdate();

    const reportA = path.join(rootDirA, '.vscode', 'agentguard-report.md');
    const reportB = path.join(rootDirB, '.vscode', 'agentguard-report.md');

    assert.ok(fs.existsSync(reportA), 'Repo A should receive its report');
    assert.ok(fs.existsSync(reportB), 'Repo B should receive its report');

    const contentA = fs.readFileSync(reportA, 'utf8');
    assert.ok(contentA.includes('RepoA'));

    autoReporter.dispose();
  });
});
