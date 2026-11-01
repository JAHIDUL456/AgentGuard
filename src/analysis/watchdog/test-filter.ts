import * as path from 'path';

const TEST_DIR_REGEX = /(?:^|[/\\])(?:test|tests|__tests__|__mocks__|spec|specs|fixtures|test_fixtures|e2e)(?:[/\\]|$)/i;

const TEST_FILE_REGEX = /(?:\.test|\.spec|_test)\.[a-zA-Z0-9]+$/i;
const PYTHON_TEST_REGEX = /^test_.*\.py$/i;
const JAVA_TEST_REGEX = /.*Test\.java$/i;
const CSHARP_TEST_REGEX = /.*Tests?\.cs$/i;
const PHP_TEST_REGEX = /.*Test\.php$/i;

/**
 * Determines whether a file path points to a test, mock, or fixture file.
 */
export function isTestFilePath(filePath: string): boolean {
  if (!filePath) {
    return false;
  }

  const normalized = filePath.replace(/\\/g, '/');

  // Directory-level match
  if (TEST_DIR_REGEX.test(normalized)) {
    return true;
  }

  const fileName = path.basename(normalized);

  // File-level match
  if (TEST_FILE_REGEX.test(fileName)) {
    return true;
  }

  if (PYTHON_TEST_REGEX.test(fileName)) {
    return true;
  }

  if (JAVA_TEST_REGEX.test(fileName)) {
    return true;
  }

  if (CSHARP_TEST_REGEX.test(fileName)) {
    return true;
  }

  if (PHP_TEST_REGEX.test(fileName)) {
    return true;
  }

  return false;
}
