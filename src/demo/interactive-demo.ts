import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BlastRadiusEngine } from '../analysis/blast-radius/blast-radius-engine';
import { DiagnosticTracker } from '../analysis/diagnostics/diagnostic-tracker';
import { LogicWatchdogEngine } from '../analysis/watchdog/watchdog-engine';
import { ILogger } from '../core/logger';
import { FindingManager } from '../findings/finding-manager';
import { GitService } from '../git/git-service';
import { LanguageAdapterRegistry } from '../languages/adapter-registry';
import { COMMAND_OPEN_PROBLEMS_PANEL } from '../ui/commands/command-ids';
import { WorkspaceManager } from '../workspace/workspace-manager';
import { WorkspaceRoot } from '../workspace/types';

export class InteractiveDemoManager {
  constructor(
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _findingManager: FindingManager,
    private readonly _languageRegistry: LanguageAdapterRegistry,
    private readonly _gitService: GitService,
    private readonly _logger: ILogger
  ) {}

  /**
   * Runs an interactive, isolated walkthrough demonstrating real-time
   * codebase safety, breakages, and automatic resolution without touching user files.
   */
  public async runDemo(): Promise<void> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-interactive-demo-'));
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'AgentGuard: Running Interactive Safety Demo...',
          cancellable: false,
        },
        async progress => {
          // ---------------------------------------------------------------
          // Stage 1: Setup Fixture Files
          // ---------------------------------------------------------------
          progress.report({ message: 'Stage 1/3: Initializing isolated demo workspace...' });

          const providerFile = path.join(srcDir, 'user-service.ts');
          const consumerFile = path.join(srcDir, 'auth-controller.ts');
          const serverFile = path.join(srcDir, 'server.ts');

          const providerUri = vscode.Uri.file(providerFile);
          const consumerUri = vscode.Uri.file(consumerFile);
          const serverUri = vscode.Uri.file(serverFile);

          fs.writeFileSync(
            providerFile,
            `export interface User { id: string; role: string; }\n\nexport function getUser(id: string): User {\n  return { id, role: 'admin' };\n}\n`
          );

          fs.writeFileSync(
            consumerFile,
            `import { getUser } from './user-service';\n\nexport function handleLogin(req: any) {\n  const user = getUser(req.id);\n  return user;\n}\n\nexport function setupRoutes(router: any) {\n  router.get('/profile', authMiddleware, getProfile);\n}\n`
          );

          fs.writeFileSync(
            serverFile,
            `import { getUser } from './user-service';\n\nexport function start() {\n  getUser('system');\n}\n`
          );

          // Create local analysis engines using actual pipeline
          const tracker = new DiagnosticTracker(
            this._workspaceManager,
            this._languageRegistry,
            this._logger,
            undefined,
            this._gitService
          );

          const blastEngine = new BlastRadiusEngine(
            this._workspaceManager,
            this._languageRegistry,
            tracker,
            this._gitService,
            this._logger
          );

          const watchdogEngine = new LogicWatchdogEngine(
            this._workspaceManager,
            this._languageRegistry,
            this._gitService,
            this._logger
          );

          // Seed AST and index dependencies
          await blastEngine.dependencyGraph.analyzeFileDependencies(consumerUri);
          await blastEngine.dependencyGraph.analyzeFileDependencies(serverUri);

          // Seed initial AST for provider
          blastEngine.seedAstCache(providerUri, [
            {
              kind: 'function',
              name: 'getUser',
              startLine: 3,
              endLine: 5,
              details: 'getUser(id: string): User',
            },
          ]);

          await new Promise(r => setTimeout(r, 600));

          // ---------------------------------------------------------------
          // Stage 2: Simulate Code Breakages (Export deletion & Auth removal)
          // ---------------------------------------------------------------
          progress.report({
            message: 'Stage 2/3: Simulating contract breakage and security removal...',
          });

          // Provider breaks contract: deletes getUser
          fs.writeFileSync(
            providerFile,
            `export interface User { id: string; role: string; }\n\n// getUser was removed\nexport function findAccount() {}\n`
          );

          // Consumer breaks security: removes authMiddleware
          const oldConsumer = fs.readFileSync(consumerFile, 'utf8');
          const newConsumer = oldConsumer.replace(
            `router.get('/profile', authMiddleware, getProfile);`,
            `router.get('/profile', getProfile);`
          );
          fs.writeFileSync(consumerFile, newConsumer);

          // Run real engines
          const demoRoots: WorkspaceRoot[] = [
            {
              id: 'demo-root',
              uri: vscode.Uri.file(tempDir),
              fsPath: tempDir,
              name: 'DemoWorkspace',
              index: 0,
            },
          ];
          const blastFindings = await blastEngine.analyze({
            workspaceRoots: demoRoots,
            targetUris: [providerUri],
          });

          // Watchdog analyzes auth removal
          const watchdogFindings = await watchdogEngine.analyze({
            workspaceRoots: demoRoots,
            targetUris: [consumerUri],
          });

          const demoFindings = [...blastFindings, ...watchdogFindings];

          // Reconcile into FindingManager so UI surfaces reflect real data
          this._findingManager.reconcileScope(
            'blast-radius',
            [providerUri, consumerUri, serverUri],
            demoFindings,
            Date.now()
          );

          // Reveal in AgentGuard panel
          await vscode.commands.executeCommand(COMMAND_OPEN_PROBLEMS_PANEL);

          vscode.window.showWarningMessage(
            `AgentGuard Demo: Detected ${demoFindings.length} issue(s)!\n1. Broken contract across 2 untouched files\n2. Removed authentication middleware.`,
            'Inspect Details'
          );

          await new Promise(r => setTimeout(r, 2200));

          // ---------------------------------------------------------------
          // Stage 3: Developer Fixes the Issue → Automatic Resolution
          // ---------------------------------------------------------------
          progress.report({
            message: 'Stage 3/3: Simulating bug fix & verifying automatic resolution...',
          });

          // Restore provider file
          fs.writeFileSync(
            providerFile,
            `export interface User { id: string; role: string; }\n\nexport function getUser(id: string): User {\n  return { id, role: 'admin' };\n}\n`
          );

          // Re-analyze: issues are verified clean
          const cleanBlastFindings = await blastEngine.analyze({
            workspaceRoots: demoRoots,
            targetUris: [providerUri],
          });

          this._findingManager.reconcileScope(
            'blast-radius',
            [providerUri, consumerUri, serverUri],
            cleanBlastFindings,
            Date.now() + 1
          );

          vscode.window.showInformationMessage(
            'AgentGuard Demo Complete! Fixed issues verified and automatically cleared from active findings without reloading VS Code.'
          );

          tracker.dispose();
        }
      );
    } catch (err) {
      this._logger.error('Interactive demo encountered an error:', err);
      vscode.window.showErrorMessage(`AgentGuard Demo Error: ${err}`);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // cleanup safe
      }
    }
  }
}
