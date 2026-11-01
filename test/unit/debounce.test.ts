import * as assert from 'assert';
import { debounce } from '../../src/utils/debounce';

suite('Debounce Utility', () => {
  test('coalesces rapid invocations and calls once', done => {
    let callCount = 0;
    let lastArg = '';

    const debounced = debounce((val: string) => {
      callCount++;
      lastArg = val;
    }, 20);

    debounced('first');
    debounced('second');
    debounced('third');

    assert.strictEqual(callCount, 0);

    setTimeout(() => {
      assert.strictEqual(callCount, 1);
      assert.strictEqual(lastArg, 'third');
      done();
    }, 40);
  });

  test('cancel() aborts pending execution', done => {
    let called = false;
    const debounced = debounce(() => {
      called = true;
    }, 20);

    debounced();
    debounced.cancel();

    setTimeout(() => {
      assert.strictEqual(called, false);
      done();
    }, 40);
  });

  test('flush() executes pending invocation immediately', () => {
    let calledWith = '';
    const debounced = debounce((val: string) => {
      calledWith = val;
    }, 100);

    debounced('immediate');
    assert.strictEqual(calledWith, '');

    debounced.flush();
    assert.strictEqual(calledWith, 'immediate');
  });
});

