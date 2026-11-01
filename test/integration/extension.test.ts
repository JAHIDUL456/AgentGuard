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
  });

  test('engine initializes to a valid state', () => {
    assert.ok(
      api.engine.state === 'ready' || api.engine.state === 'initializing',
      `Engine should be in ready or initializing state, got: ${api.engine.state}`
    );
  });

  test('can execute scan command and clear findings', async () => {
    await vscode.commands.executeCommand(COMMAND_SCAN_WORKSPACE);
    const findings = api.findingManager.getAll();
    assert.strictEqual(
      findings.length,
      0,
      'Stage 1 should have zero fake findings'
    );

    await vscode.commands.executeCommand(COMMAND_CLEAR_FINDINGS);
    assert.strictEqual(api.findingManager.getAll().length, 0);
  });
});

