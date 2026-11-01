import * as assert from 'assert';
import * as vscode from 'vscode';
import { AgentGuardApi } from '../../src/extension';
import {
  COMMAND_CLEAR_FINDINGS,
  COMMAND_GENERATE_REPORT,
  COMMAND_SCAN_WORKSPACE,
  COMMAND_SHOW_OUTPUT,
} from '../../src/ui/commands/command-ids';

suite('AgentGuard Extension Integration Test', () => {
  let api: AgentGuardApi;

  suiteSetup(async () => {
    // Obtain and activate extension
    const extension = vscode.extensions.getExtension<AgentGuardApi>(
      'agentguard.agentguard'
    );
    assert.ok(extension, 'Extension agentguard.agentguard should be found');

    api = await extension.activate();
    assert.ok(api, 'Extension activation should return AgentGuardApi');
  });

  test('registers all AgentGuard commands in VS Code', async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(
      commands.includes(COMMAND_SCAN_WORKSPACE),
      `Command ${COMMAND_SCAN_WORKSPACE} should be registered`
    );
    assert.ok(
      commands.includes(COMMAND_SHOW_OUTPUT),
      `Command ${COMMAND_SHOW_OUTPUT} should be registered`
    );
    assert.ok(
      commands.includes(COMMAND_GENERATE_REPORT),
      `Command ${COMMAND_GENERATE_REPORT} should be registered`
    );
    assert.ok(
      commands.includes(COMMAND_CLEAR_FINDINGS),
      `Command ${COMMAND_CLEAR_FINDINGS} should be registered`
    );
  });

  test('status bar manager initializes and sets text', () => {
    assert.ok(api.statusBarManager, 'Status bar manager should exist');
    assert.ok(
      api.statusBarManager.item.text.includes('AgentGuard'),
      'Status bar should display AgentGuard prefix'
    );
  });

  test('tree view provider supplies root state items', async () => {
    const children = await api.treeProvider.getChildren();
    assert.ok(children.length > 0, 'Tree provider should provide initial items');
    if (api.workspaceManager.hasWorkspace()) {
      assert.ok(
        children.some(item => item.label === 'Git Status' || item.label === 'Git Integration'),
        'Tree provider should display Git integration or fallback status'
      );
    } else {
      assert.ok(
        children.some(item => String(item.description).includes('Waiting for workspace') || item.label === 'No Workspace Open'),
        'Tree provider should display waiting for workspace state'
      );
    }
  });

  test('engine initializes to a valid state', () => {
    assert.ok(
      api.engine.state === 'ready' || api.engine.state === 'initializing',
      `Engine should be in ready or initializing state, got: ${api.engine.state}`
    );
  });

  test('git service reports availability status', async () => {
    const available = await api.gitService.isGitAvailable();
    assert.strictEqual(typeof available, 'boolean');
  });

  test('can execute scan command and clear findings', async () => {
    await vscode.commands.executeCommand(COMMAND_SCAN_WORKSPACE);
    const findings = api.findingManager.getAll();
    assert.strictEqual(
      findings.length,
      0,
      'Stage 2 should have zero fake findings'
    );

    await vscode.commands.executeCommand(COMMAND_CLEAR_FINDINGS);
    assert.strictEqual(api.findingManager.getAll().length, 0);
  });

  test('change monitor is enabled and can enqueue / flush batches', () => {
    assert.strictEqual(api.changeMonitor.isEnabled(), true);
    api.changeMonitor.clearQueue();
    assert.strictEqual(api.changeMonitor.getPendingCount(), 0);
  });

  test('registers all 11 language adapters in live extension host', () => {
    const adapters = api.languageRegistry.getAdapters();
    assert.strictEqual(adapters.length, 11);
    assert.ok(adapters.some(a => a.id === 'typescript'));
    assert.ok(adapters.some(a => a.id === 'python'));
    assert.ok(adapters.some(a => a.id === 'go'));
    assert.ok(adapters.some(a => a.id === 'rust'));
  });

  test('registers Stage 4 & Stage 5 analysis engines in extension host', () => {
    const engines = api.analysisRegistry.getEngines();
    assert.ok(engines.length >= 3, 'Should register at least 3 analysis engines');
    assert.ok(
      engines.some(e => e.id === 'agentguard.diagnostic-delta'),
      'DiagnosticDeltaEngine should be registered'
    );
    assert.ok(
      engines.some(e => e.id === 'agentguard.blast-radius'),
      'BlastRadiusEngine should be registered'
    );
    assert.ok(
      engines.some(e => e.id === 'agentguard.logic-watchdog'),
      'LogicWatchdogEngine should be registered'
    );
    assert.ok(api.diagnosticTracker, 'DiagnosticTracker should be available on API');
    assert.ok(api.blastRadiusEngine, 'BlastRadiusEngine should be available on API');
    assert.ok(api.logicWatchdogEngine, 'LogicWatchdogEngine should be available on API');
  });
});
