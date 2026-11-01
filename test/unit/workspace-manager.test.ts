import * as assert from 'assert';
import * as vscode from 'vscode';
import { NullLogger } from '../../src/core/logger';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';

suite('WorkspaceManager', () => {
  let manager: WorkspaceManager;

  setup(() => {
    // Set up mock folders
    (vscode.workspace as any).workspaceFolders = [
      {
        uri: vscode.Uri.file('/projects/agentguard-frontend'),
        name: 'frontend',
        index: 0,
      },
      {
        uri: vscode.Uri.file('/projects/agentguard-backend'),
        name: 'backend',
        index: 1,
      },
    ];
    manager = new WorkspaceManager(new NullLogger());
  });

  teardown(() => {
    manager.dispose();
    (vscode.workspace as any).workspaceFolders = [];
  });

  test('reports multi-root workspace folders correctly', () => {
    assert.strictEqual(manager.hasWorkspace(), true);
    assert.strictEqual(manager.getRoots().length, 2);
  });

  test('resolves matching root for file URI', () => {
    const fileUri = vscode.Uri.file(
      '/projects/agentguard-backend/src/controller.ts'
    );
    const root = manager.getRootForUri(fileUri);
    assert.ok(root);
    assert.strictEqual(root.name, 'backend');
  });

  test('returns undefined for file URI outside workspace roots', () => {
    const outsideUri = vscode.Uri.file('/etc/hosts');
    const root = manager.getRootForUri(outsideUri);
    assert.strictEqual(root, undefined);
  });
});

