import * as assert from 'assert';
import { AnalysisEngineRegistry } from '../../src/analysis/analyzer-registry';
import { IAnalysisEngine } from '../../src/analysis/types';
import { NullLogger } from '../../src/core/logger';

suite('AnalysisEngineRegistry', () => {
  let registry: AnalysisEngineRegistry;

  setup(() => {
    registry = new AnalysisEngineRegistry(new NullLogger());
  });

  teardown(() => {
    registry.dispose();
  });

  const mockEngine: IAnalysisEngine = {
    id: 'mock-engine',
    name: 'Mock Engine',
    category: 'logic-risk',
    analyze: async () => [],
  };

  test('registers and retrieves analysis engines', () => {
    const disposable = registry.registerEngine(mockEngine);

    assert.strictEqual(registry.getEngines().length, 1);
    assert.strictEqual(registry.getEngine('mock-engine')?.name, 'Mock Engine');

    const byCat = registry.getEnginesByCategory('logic-risk');
    assert.strictEqual(byCat.length, 1);

    const emptyCat = registry.getEnginesByCategory('broken-dependency');
    assert.strictEqual(emptyCat.length, 0);

    disposable.dispose();
    assert.strictEqual(registry.getEngines().length, 0);
  });
});

