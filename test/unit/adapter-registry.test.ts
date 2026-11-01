import * as assert from 'assert';
import * as vscode from 'vscode';
import { NullLogger } from '../../src/core/logger';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { ILanguageAdapter } from '../../src/languages/types';

suite('LanguageAdapterRegistry', () => {
  let registry: LanguageAdapterRegistry;

  setup(() => {
    registry = new LanguageAdapterRegistry(new NullLogger());
  });

  teardown(() => {
    registry.dispose();
  });

  const tsAdapter: ILanguageAdapter = {
    id: 'typescript',
    displayName: 'TypeScript',
    fileExtensions: ['.ts', '.tsx'],
    capabilities: ['diagnostics', 'ast-inspection'],
    supports: (uri: vscode.Uri) =>
      uri.fsPath.endsWith('.ts') || uri.fsPath.endsWith('.tsx'),
  };

  test('registers and queries adapters by file extension', () => {
    const disposable = registry.registerAdapter(tsAdapter);

    assert.strictEqual(registry.getAdapters().length, 1);

    const matchTs = registry.getAdapterForUri(vscode.Uri.file('/app/main.ts'));
    assert.strictEqual(matchTs?.id, 'typescript');

    const matchPy = registry.getAdapterForUri(vscode.Uri.file('/app/main.py'));
    assert.strictEqual(matchPy, undefined);

    disposable.dispose();
    assert.strictEqual(registry.getAdapters().length, 0);
  });

  test('disallows duplicate adapter registration', () => {
    registry.registerAdapter(tsAdapter);
    assert.throws(() => {
      registry.registerAdapter(tsAdapter);
    }, /already registered/);
  });
});

