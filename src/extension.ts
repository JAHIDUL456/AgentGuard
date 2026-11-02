import * as vscode from 'vscode';
import { AnalysisEngineRegistry } from './analysis/analyzer-registry';
import { BlastRadiusEngine } from './analysis/blast-radius/blast-radius-engine';
import { DiagnosticDeltaEngine } from './analysis/diagnostics/diagnostic-delta-engine';
import { DiagnosticTracker } from './analysis/diagnostics/diagnostic-tracker';
import { LogicWatchdogEngine } from './analysis/watchdog/watchdog-engine';
import { AgentGuardEngine } from './core/engine';
import { ILogger, LogLevel, OutputChannelLogger } from './core/logger';
import { FindingManager } from './findings/finding-manager';
import { NativeDiagnosticsPublisher } from './findings/native-diagnostics';
import { GitService } from './git/git-service';
import { LanguageAdapterRegistry } from './languages/adapter-registry';
import { ChangeMonitor } from './monitoring/change-monitor';
import { AutoReportManager } from './reporting/auto-reporter';
import { InteractiveDemoManager } from './demo/interactive-demo';
import { MarkdownReporter } from './reporting/markdown-reporter';
import { CommandHandler } from './ui/commands/command-handler';
import { FindingHoverProvider } from './ui/hover/finding-hover-provider';
import { IssuesPanelProvider } from './ui/panel/issues-panel-provider';
import { SidebarViewProvider } from './ui/sidebar/sidebar-view-provider';
import { StatusBarManager } from './ui/status-bar/status-bar-manager';
import { AgentGuardTreeProvider } from './ui/tree/agentguard-tree-provider';
import { WorkspaceManager } from './workspace/workspace-manager';

export interface AgentGuardApi {
  readonly engine: AgentGuardEngine;
  readonly workspaceManager: WorkspaceManager;
  readonly changeMonitor: ChangeMonitor;
  readonly gitService: GitService;
  readonly languageRegistry: LanguageAdapterRegistry;
  readonly analysisRegistry: AnalysisEngineRegistry;
  readonly findingManager: FindingManager;
  readonly diagnosticTracker: DiagnosticTracker;
  readonly diagnosticEngine: DiagnosticDeltaEngine;
  readonly blastRadiusEngine: BlastRadiusEngine;
  readonly logicWatchdogEngine: LogicWatchdogEngine;
  readonly nativeDiagnosticsPublisher: NativeDiagnosticsPublisher;
  readonly autoReporter: AutoReportManager;
  readonly markdownReporter: MarkdownReporter;
  readonly treeProvider: AgentGuardTreeProvider;
  readonly sidebarProvider: SidebarViewProvider;
  readonly issuesPanelProvider: IssuesPanelProvider;
  readonly demoManager: InteractiveDemoManager;
  readonly statusBarManager: StatusBarManager;
  readonly logger: ILogger;
}

let activeApi: AgentGuardApi | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<AgentGuardApi> {
  // Read initial configuration
  const config = vscode.workspace.getConfiguration('agentguard');
  const configuredLogLevel = config.get<LogLevel>('logLevel', 'info');
  const isEnabled = config.get<boolean>('enabled', true);

  // Initialize Logger
  const logger = new OutputChannelLogger('AgentGuard', configuredLogLevel);
  context.subscriptions.push(logger);
  logger.info('AgentGuard extension activating...');

  // Initialize Subsystems
  const workspaceManager = new WorkspaceManager(logger);
  context.subscriptions.push(workspaceManager);

  const changeMonitor = new ChangeMonitor(logger);
  changeMonitor.setEnabled(isEnabled);
  context.subscriptions.push(changeMonitor);

  const gitService = new GitService(logger);
  context.subscriptions.push(gitService);

  const languageRegistry = new LanguageAdapterRegistry(logger);
  languageRegistry.registerBuiltinAdapters();
  context.subscriptions.push(languageRegistry);

  const analysisRegistry = new AnalysisEngineRegistry(logger);
  context.subscriptions.push(analysisRegistry);

  const diagnosticTracker = new DiagnosticTracker(
    workspaceManager,
    languageRegistry,
    logger,
    undefined,
    gitService
  );
  context.subscriptions.push(diagnosticTracker);

  const diagnosticEngine = new DiagnosticDeltaEngine(diagnosticTracker, logger);
  analysisRegistry.registerEngine(diagnosticEngine);

  const blastRadiusEngine = new BlastRadiusEngine(
    workspaceManager,
    languageRegistry,
    diagnosticTracker,
    gitService,
    logger
  );
  analysisRegistry.registerEngine(blastRadiusEngine);

  const logicWatchdogEngine = new LogicWatchdogEngine(
    workspaceManager,
    languageRegistry,
    gitService,
    logger
  );
  analysisRegistry.registerEngine(logicWatchdogEngine);

  const findingManager = new FindingManager(logger);
  context.subscriptions.push(findingManager);

  // Central Orchestration Engine
  const engine = new AgentGuardEngine(
    workspaceManager,
    changeMonitor,
    findingManager,
    languageRegistry,
    analysisRegistry,
    gitService,
    logger
  );
  context.subscriptions.push(engine);

  // UI Providers: Professional Sidebar Webview & Dedicated Bottom Panel
  const sidebarProvider = new SidebarViewProvider(
    context.extensionUri,
    engine,
    workspaceManager,
    findingManager,
    changeMonitor
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarViewProvider.viewType,
      sidebarProvider
    )
  );

  const issuesPanelProvider = new IssuesPanelProvider(
    context.extensionUri,
    engine,
    workspaceManager,
    findingManager,
    changeMonitor
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      IssuesPanelProvider.viewType,
      issuesPanelProvider
    )
  );

  const treeProvider = new AgentGuardTreeProvider(
    engine,
    workspaceManager,
    findingManager,
    languageRegistry
  );

  const statusBarManager = new StatusBarManager(
    engine,
    workspaceManager,
    findingManager,
    diagnosticTracker
  );
  context.subscriptions.push(statusBarManager);

  // Native Diagnostics Publisher (publishes findings to VS Code Problems tab)
  const nativeDiagnosticsPublisher = new NativeDiagnosticsPublisher(
    findingManager,
    logger
  );
  context.subscriptions.push(nativeDiagnosticsPublisher);

  // Editor Hover Provider (with Copy AI Fix Prompt & Open in Panel)
  const hoverProvider = new FindingHoverProvider(findingManager);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider)
  );

  // Reporting & Commands
  const markdownReporter = new MarkdownReporter();
  const autoReportEnabled = config.get<boolean>('autoReport', false);
  const autoReporter = new AutoReportManager(
    engine,
    workspaceManager,
    findingManager,
    languageRegistry,
    markdownReporter,
    logger,
    400,
    autoReportEnabled
  );
  context.subscriptions.push(autoReporter);

  const demoManager = new InteractiveDemoManager(
    workspaceManager,
    findingManager,
    languageRegistry,
    gitService,
    logger
  );

  const commandHandler = new CommandHandler(
    engine,
    workspaceManager,
    findingManager,
    markdownReporter,
    logger,
    changeMonitor,
    issuesPanelProvider,
    demoManager
  );
  context.subscriptions.push(commandHandler);

  // Listen to configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('agentguard.logLevel')) {
        const newLevel = vscode.workspace
          .getConfiguration('agentguard')
          .get<LogLevel>('logLevel', 'info');
        logger.setLevel(newLevel);
        logger.info(`Log level changed to: ${newLevel}`);
      }
      if (e.affectsConfiguration('agentguard.enabled')) {
        const enabled = vscode.workspace
          .getConfiguration('agentguard')
          .get<boolean>('enabled', true);
        changeMonitor.setEnabled(enabled);
      }
      if (e.affectsConfiguration('agentguard.autoReport')) {
        const autoReport = vscode.workspace
          .getConfiguration('agentguard')
          .get<boolean>('autoReport', false);
        autoReporter.setAutoWrite(autoReport);
      }
    })
  );

  // Boot Engine
  await engine.initialize();

  // Asynchronously initialize diagnostic baseline in the background
  diagnosticTracker.captureBaseline().catch(err => {
    logger.debug('Background diagnostic baseline capture warning:', err);
  });

  activeApi = {
    engine,
    workspaceManager,
    changeMonitor,
    gitService,
    languageRegistry,
    analysisRegistry,
    findingManager,
    diagnosticTracker,
    diagnosticEngine,
    blastRadiusEngine,
    logicWatchdogEngine,
    nativeDiagnosticsPublisher,
    autoReporter,
    markdownReporter,
    treeProvider,
    sidebarProvider,
    issuesPanelProvider,
    demoManager,
    statusBarManager,
    logger,
  };

  logger.info('AgentGuard extension successfully activated.');
  return activeApi;
}

export function deactivate(): void {
  activeApi = undefined;
}

