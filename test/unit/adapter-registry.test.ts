import * as assert from 'assert';
import * as vscode from 'vscode';
import { NullLogger } from '../../src/core/logger';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { ILanguageAdapter } from '../../src/languages/types';

import { TypeScriptAdapter } from '../../src/languages/adapters/typescript-adapter';

suite('LanguageAdapterRegistry', () => {
  let registry: LanguageAdapterRegistry;
  let tsAdapter: TypeScriptAdapter;

  setup(() => {
    registry = new LanguageAdapterRegistry(new NullLogger());
    tsAdapter = new TypeScriptAdapter(new NullLogger());
  });

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

