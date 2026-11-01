import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { NullLogger } from '../../src/core/logger';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { WorkspaceLanguageDetector } from '../../src/languages/workspace-detector';

suite('WorkspaceLanguageDetector (Multi-Language & Nested Project Detection)', () => {
  let registry: LanguageAdapterRegistry;
  let detector: WorkspaceLanguageDetector;
  const fixturesRoot = path.join(__dirname, '../../../test/fixtures/languages');

  setup(() => {
    registry = new LanguageAdapterRegistry(new NullLogger());
    registry.registerBuiltinAdapters();
    detector = new WorkspaceLanguageDetector(registry, new NullLogger());
  });

  teardown(() => {
    registry.dispose();
  });

  test('detects single-language TypeScript workspace', async () => {
    const tsDir = vscode.Uri.file(path.join(fixturesRoot, 'typescript'));
    const summary = await detector.detectWorkspace([tsDir]);

    assert.ok(summary.detectedLanguages.some(l => l.id === 'typescript'));
    assert.strictEqual(summary.isMultiLanguage, false);
    assert.ok(summary.manifests.some(m => m.manifestName === 'tsconfig.json'));
  });

  test('detects single-language Rust workspace via Cargo.toml', async () => {
    const rustDir = vscode.Uri.file(path.join(fixturesRoot, 'rust'));
    const summary = await detector.detectWorkspace([rustDir]);

    assert.ok(summary.detectedLanguages.some(l => l.id === 'rust'));
    assert.strictEqual(summary.isMultiLanguage, false);
    assert.ok(summary.manifests.some(m => m.manifestName === 'Cargo.toml'));
  });

  test('detects multi-language workspace with nested projects (frontend JS/TS + backend Go)', async () => {
    const multiLangDir = vscode.Uri.file(path.join(fixturesRoot, 'multilang'));
    const summary = await detector.detectWorkspace([multiLangDir]);

    assert.strictEqual(summary.isMultiLanguage, true);
    assert.ok(summary.detectedLanguages.length >= 2);
    assert.ok(summary.detectedLanguages.some(l => l.id === 'javascript'));
    assert.ok(summary.detectedLanguages.some(l => l.id === 'go'));

    assert.ok(summary.manifests.some(m => m.manifestName.includes('package.json')));
    assert.ok(summary.manifests.some(m => m.manifestName.includes('go.mod')));
  });

  test('detects languages across multi-root workspace folders', async () => {
    const pythonRoot = vscode.Uri.file(path.join(fixturesRoot, 'python'));
    const goRoot = vscode.Uri.file(path.join(fixturesRoot, 'go'));

    const summary = await detector.detectWorkspace([pythonRoot, goRoot]);

    assert.strictEqual(summary.isMultiLanguage, true);
    assert.ok(summary.detectedLanguages.some(l => l.id === 'python'));
    assert.ok(summary.detectedLanguages.some(l => l.id === 'go'));
  });
});
