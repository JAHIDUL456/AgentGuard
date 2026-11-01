import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AuthenticationRule } from '../../src/analysis/watchdog/rules/authentication-rule';
import { AuthorizationRule } from '../../src/analysis/watchdog/rules/authorization-rule';
import { ErrorHandlingRule } from '../../src/analysis/watchdog/rules/error-handling-rule';
import { SecurityRule } from '../../src/analysis/watchdog/rules/security-rule';
import { TypeSafetyRule } from '../../src/analysis/watchdog/rules/type-safety-rule';
import { ValidationRule } from '../../src/analysis/watchdog/rules/validation-rule';
import { isTestFilePath } from '../../src/analysis/watchdog/test-filter';
import { LogicWatchdogEngine } from '../../src/analysis/watchdog/watchdog-engine';
import { NullLogger } from '../../src/core/logger';
import { GitService } from '../../src/git/git-service';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';

suite('Critical Logic & Safety Watchdog Engine', () => {
  const logger = new NullLogger();

  test('1. POSITIVE: Detects removed authentication middleware / guard', async () => {
    const rule = new AuthenticationRule();

    const oldContent = `
import { Router } from 'express';
import { authMiddleware } from './auth';

const router = Router();
router.get('/account', authMiddleware, getAccount);
`;

    const newContent = `
import { Router } from 'express';

const router = Router();
router.get('/account', getAccount);
`;

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/routes.ts'),
      relativeFilePath: 'routes.ts',
      isTestFile: false,
      oldContent,
      newContent,
      removedLines: [
        { line: 2, text: "import { authMiddleware } from './auth';", trimmed: "import { authMiddleware } from './auth';" },
        { line: 5, text: "router.get('/account', authMiddleware, getAccount);", trimmed: "router.get('/account', authMiddleware, getAccount);" },
      ],
      addedLines: [
        { line: 4, text: "router.get('/account', getAccount);", trimmed: "router.get('/account', getAccount);" },
      ],
      languageId: 'typescript',
    });

    assert.ok(findings.length > 0, 'Should detect authentication guard removal');
    const f = findings[0]!;
    assert.strictEqual(f.category, 'authentication');
    assert.strictEqual(f.severity, 'critical');
    assert.strictEqual(f.confidence, 'high');
    assert.ok(f.title.includes('Authentication'));
    assert.ok(f.evidence.includes('authMiddleware'));
  });

  test('2. POSITIVE: Detects removed authorization / role-check branch', async () => {
    const rule = new AuthorizationRule();

    const oldContent = `
export function deleteDatabase(user: User) {
  if (!user.isAdmin) {
    throw new ForbiddenError('Admin required');
  }
  db.drop();
}
`;

    const newContent = `
export function deleteDatabase(user: User) {
  db.drop();
}
`;

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/admin.ts'),
      relativeFilePath: 'admin.ts',
      isTestFile: false,
      oldContent,
      newContent,
      removedLines: [
        { line: 2, text: '  if (!user.isAdmin) {', trimmed: 'if (!user.isAdmin) {' },
        { line: 3, text: "    throw new ForbiddenError('Admin required');", trimmed: "throw new ForbiddenError('Admin required');" },
        { line: 4, text: '  }', trimmed: '}' },
      ],
      addedLines: [],
      languageId: 'typescript',
    });

    assert.ok(findings.length > 0, 'Should detect authorization branch removal');
    const f = findings[0]!;
    assert.strictEqual(f.category, 'authorization');
    assert.strictEqual(f.severity, 'critical');
    assert.ok(f.title.includes('Authorization'));
    assert.ok(f.evidence.includes('user.isAdmin'));
  });

  test('3. POSITIVE: Detects removed input / schema validation', async () => {
    const rule = new ValidationRule();

    const oldContent = `
export async function createItem(req: Request) {
  schema.parse(req.body);
  await db.insert(req.body);
}
`;

    const newContent = `
export async function createItem(req: Request) {
  await db.insert(req.body);
}
`;

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/items.ts'),
      relativeFilePath: 'items.ts',
      isTestFile: false,
      oldContent,
      newContent,
      removedLines: [
        { line: 2, text: '  schema.parse(req.body);', trimmed: 'schema.parse(req.body);' },
      ],
      addedLines: [],
      languageId: 'typescript',
    });

    assert.strictEqual(findings.length, 1);
    const f = findings[0]!;
    assert.strictEqual(f.category, 'validation');
    assert.strictEqual(f.severity, 'warning');
    assert.ok(f.title.includes('Validation'));
    assert.ok(f.evidence.includes('schema.parse'));
  });

  test('4. POSITIVE: Detects removed exception / error handling block', async () => {
    const rule = new ErrorHandlingRule();

    const oldContent = `
export async function loadData() {
  try {
    return await fetchData();
  } catch (err) {
    logger.error(err);
    return fallbackData;
  }
}
`;

    const newContent = `
export async function loadData() {
  return await fetchData();
}
`;

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/loader.ts'),
      relativeFilePath: 'loader.ts',
      isTestFile: false,
      oldContent,
      newContent,
      removedLines: [
        { line: 2, text: '  try {', trimmed: 'try {' },
        { line: 4, text: '  } catch (err) {', trimmed: '} catch (err) {' },
        { line: 5, text: '    logger.error(err);', trimmed: 'logger.error(err);' },
        { line: 6, text: '    return fallbackData;', trimmed: 'return fallbackData;' },
        { line: 7, text: '  }', trimmed: '}' },
      ],
      addedLines: [],
      languageId: 'typescript',
    });

    assert.ok(findings.length > 0, 'Should detect catch block removal');
    const f = findings[0]!;
    assert.strictEqual(f.category, 'error-handling');
    assert.strictEqual(f.severity, 'warning');
    assert.ok(f.title.includes('catch'));
  });

  test('5. NEGATIVE: Suppresses finding when equivalent logic was moved elsewhere in the file', async () => {
    const rule = new AuthenticationRule();

    // The auth check was moved into a helper function inside the same file
    const oldContent = `
export function handleRequest(req: Request) {
  if (!req.isAuthenticated()) {
    throw new Error('Unauthorized');
  }
  process();
}
`;

    const newContent = `
export function handleRequest(req: Request) {
  assertAuth(req);
  process();
}

function assertAuth(req: Request) {
  if (!req.isAuthenticated()) {
    throw new Error('Unauthorized');
  }
}
`;

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/service.ts'),
      relativeFilePath: 'service.ts',
      isTestFile: false,
      oldContent,
      newContent,
      removedLines: [
        { line: 2, text: '  if (!req.isAuthenticated()) {', trimmed: 'if (!req.isAuthenticated()) {' },
        { line: 3, text: "    throw new Error('Unauthorized');", trimmed: "throw new Error('Unauthorized');" },
        { line: 4, text: '  }', trimmed: '}' },
      ],
      addedLines: [
        { line: 2, text: '  assertAuth(req);', trimmed: 'assertAuth(req);' },
        { line: 7, text: 'function assertAuth(req: Request) {', trimmed: 'function assertAuth(req: Request) {' },
        { line: 8, text: '  if (!req.isAuthenticated()) {', trimmed: 'if (!req.isAuthenticated()) {' },
      ],
      languageId: 'typescript',
    });

    assert.strictEqual(
      findings.length,
      0,
      'Moved auth logic must not trigger a false-positive removal alert'
    );
  });

  test('6. NEGATIVE: Does not flag removal of comments mentioning security terms', async () => {
    const rule = new AuthenticationRule();

    const oldContent = `
// TODO: checkAuth(req) should be added here
export function publicRoute() {
  return 200;
}
`;

    const newContent = `
export function publicRoute() {
  return 200;
}
`;

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/public.ts'),
      relativeFilePath: 'public.ts',
      isTestFile: false,
      oldContent,
      newContent,
      removedLines: [
        { line: 1, text: '// TODO: checkAuth(req) should be added here', trimmed: '// TODO: checkAuth(req) should be added here' },
      ],
      addedLines: [],
      languageId: 'typescript',
    });

    assert.strictEqual(
      findings.length,
      0,
      'Comment removal must never trigger a security finding'
    );
  });

  test('7. NEGATIVE: Does not flag string literal changes in logs or templates', async () => {
    const rule = new AuthenticationRule();

    const oldContent = `
logger.info("User session isValid check performed");
`;

    const newContent = `
logger.info("Heartbeat completed");
`;

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/heartbeat.ts'),
      relativeFilePath: 'heartbeat.ts',
      isTestFile: false,
      oldContent,
      newContent,
      removedLines: [
        { line: 1, text: 'logger.info("User session isValid check performed");', trimmed: 'logger.info("User session isValid check performed");' },
      ],
      addedLines: [
        { line: 1, text: 'logger.info("Heartbeat completed");', trimmed: 'logger.info("Heartbeat completed");' },
      ],
      languageId: 'typescript',
    });

    assert.strictEqual(
      findings.length,
      0,
      'String literal log text removal must not trigger a security finding'
    );
  });

  test('8. NEGATIVE: Ignores changes made inside test files and fixtures', async () => {
    const rule = new AuthenticationRule();

    assert.strictEqual(isTestFilePath('/app/tests/auth.test.ts'), true);
    assert.strictEqual(isTestFilePath('/app/src/__tests__/routes.spec.js'), true);
    assert.strictEqual(isTestFilePath('/app/test_api.py'), true);
    assert.strictEqual(isTestFilePath('/app/pkg/service_test.go'), true);

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/tests/auth.test.ts'),
      relativeFilePath: 'tests/auth.test.ts',
      isTestFile: true,
      oldContent: 'authMiddleware(req);',
      newContent: '',
      removedLines: [
        { line: 1, text: 'authMiddleware(req);', trimmed: 'authMiddleware(req);' },
      ],
      addedLines: [],
      languageId: 'typescript',
    });

    assert.strictEqual(
      findings.length,
      0,
      'Test file edits should be suppressed from production security alerts'
    );
  });

  test('9. NEGATIVE: Suppresses finding when function was renamed to an equivalent term', async () => {
    const rule = new AuthenticationRule();

    const oldContent = `
export function login(token: string) {
  checkAuth(token);
}
`;

    const newContent = `
export function login(token: string) {
  validateToken(token);
}
`;

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/login.ts'),
      relativeFilePath: 'login.ts',
      isTestFile: false,
      oldContent,
      newContent,
      removedLines: [
        { line: 2, text: '  checkAuth(token);', trimmed: 'checkAuth(token);' },
      ],
      addedLines: [
        { line: 2, text: '  validateToken(token);', trimmed: 'validateToken(token);' },
      ],
      languageId: 'typescript',
    });

    assert.strictEqual(
      findings.length,
      0,
      'Renaming checkAuth to validateToken is a safe replacement and must not alert'
    );
  });

  test('10. NEGATIVE: Safe refactoring with preserved authorization logic', async () => {
    const rule = new AuthorizationRule();

    const oldContent = `
function check(user: User) {
  if (!user.roles.includes('admin')) {
    throw new Error('Forbidden');
  }
}
`;

    const newContent = `
function check(user: User) {
  const isSuperUser = user.roles.includes('admin');
  if (!isSuperUser) {
    throw new Error('Forbidden');
  }
}
`;

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/authz.ts'),
      relativeFilePath: 'authz.ts',
      isTestFile: false,
      oldContent,
      newContent,
      removedLines: [
        { line: 2, text: "  if (!user.roles.includes('admin')) {", trimmed: "if (!user.roles.includes('admin')) {" },
      ],
      addedLines: [
        { line: 2, text: "  const isSuperUser = user.roles.includes('admin');", trimmed: "const isSuperUser = user.roles.includes('admin');" },
        { line: 3, text: '  if (!isSuperUser) {', trimmed: 'if (!isSuperUser) {' },
      ],
      languageId: 'typescript',
    });

    assert.strictEqual(
      findings.length,
      0,
      'Refactoring that preserves user.roles check must not alert'
    );
  });

  test('11. POSITIVE: Detects parameterized SQL query replaced with dynamic string interpolation', async () => {
    const rule = new SecurityRule();

    const oldContent = `
export async function getUser(id: string) {
  return await db.query('SELECT * FROM users WHERE id = $1', [id]);
}
`;

    const newContent = `
export async function getUser(id: string) {
  return await db.query(\`SELECT * FROM users WHERE id = \${id}\`);
}
`;

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/repo.ts'),
      relativeFilePath: 'repo.ts',
      isTestFile: false,
      oldContent,
      newContent,
      removedLines: [
        { line: 2, text: "  return await db.query('SELECT * FROM users WHERE id = $1', [id]);", trimmed: "return await db.query('SELECT * FROM users WHERE id = $1', [id]);" },
      ],
      addedLines: [
        { line: 2, text: '  return await db.query(`SELECT * FROM users WHERE id = ${id}`);', trimmed: 'return await db.query(`SELECT * FROM users WHERE id = ${id}`);' },
      ],
      languageId: 'typescript',
    });

    assert.strictEqual(findings.length, 1);
    const f = findings[0]!;
    assert.strictEqual(f.category, 'security');
    assert.strictEqual(f.severity, 'critical');
    assert.ok(f.title.includes('SQL'));
    assert.ok(f.explanation.includes('SQL injection'));
  });

  test('12. POSITIVE: Detects CSRF protection middleware removal', async () => {
    const rule = new SecurityRule();

    const oldContent = `
import csurf from 'csurf';
app.use(csurf());
`;

    const newContent = `
// removed
`;

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/server.ts'),
      relativeFilePath: 'server.ts',
      isTestFile: false,
      oldContent,
      newContent,
      removedLines: [
        { line: 2, text: 'app.use(csurf());', trimmed: 'app.use(csurf());' },
      ],
      addedLines: [],
      languageId: 'typescript',
    });

    assert.strictEqual(findings.length, 1);
    const f = findings[0]!;
    assert.strictEqual(f.category, 'security');
    assert.strictEqual(f.severity, 'critical');
    assert.ok(f.title.includes('CSRF'));
  });

  test('13. POSITIVE: Detects type-safety suppression directives (@ts-ignore / as any)', async () => {
    const rule = new TypeSafetyRule();

    const findings = await rule.inspect({
      uri: vscode.Uri.file('/app/types.ts'),
      relativeFilePath: 'types.ts',
      isTestFile: false,
      oldContent: '',
      newContent: `
// @ts-ignore
const data = (raw as any).field;
`,
      removedLines: [],
      addedLines: [
        { line: 1, text: '// @ts-ignore', trimmed: '// @ts-ignore' },
        { line: 2, text: 'const data = (raw as any).field;', trimmed: 'const data = (raw as any).field;' },
      ],
      languageId: 'typescript',
    });

    assert.ok(findings.length >= 2, 'Should flag both @ts-ignore and as any');
    assert.strictEqual(findings[0]!.category, 'type-safety');
    assert.strictEqual(findings[0]!.severity, 'review');
  });

  test('14. Multi-Language: Detects Python @login_required and try/except removals', async () => {
    const authRule = new AuthenticationRule();
    const errRule = new ErrorHandlingRule();

    const authFindings = await authRule.inspect({
      uri: vscode.Uri.file('/app/views.py'),
      relativeFilePath: 'views.py',
      isTestFile: false,
      oldContent: '@login_required\ndef profile():\n    pass',
      newContent: 'def profile():\n    pass',
      removedLines: [
        { line: 0, text: '@login_required', trimmed: '@login_required' },
      ],
      addedLines: [],
      languageId: 'python',
    });

    assert.strictEqual(authFindings.length, 1);
    assert.ok(authFindings[0]!.title.includes('Authentication'));

    const errFindings = await errRule.inspect({
      uri: vscode.Uri.file('/app/calc.py'),
      relativeFilePath: 'calc.py',
      isTestFile: false,
      oldContent: 'try:\n    x = 1 / 0\nexcept ZeroDivisionError:\n    pass',
      newContent: 'x = 1 / 0',
      removedLines: [
        { line: 2, text: 'except ZeroDivisionError:', trimmed: 'except ZeroDivisionError:' },
      ],
      addedLines: [],
      languageId: 'python',
    });

    assert.strictEqual(errFindings.length, 1);
    assert.strictEqual(errFindings[0]!.category, 'error-handling');
  });

  test('15. Multi-Language: Detects Go if err != nil error handling removal', async () => {
    const errRule = new ErrorHandlingRule();

    const findings = await errRule.inspect({
      uri: vscode.Uri.file('/app/main.go'),
      relativeFilePath: 'main.go',
      isTestFile: false,
      oldContent: `
val, err := fetch()
if err != nil {
    return err
}
`,
      newContent: `
val, _ := fetch()
`,
      removedLines: [
        { line: 2, text: 'if err != nil {', trimmed: 'if err != nil {' },
        { line: 3, text: '    return err', trimmed: 'return err' },
        { line: 4, text: '}', trimmed: '}' },
      ],
      addedLines: [
        { line: 1, text: 'val, _ := fetch()', trimmed: 'val, _ := fetch()' },
      ],
      languageId: 'go',
    });

    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0]!.category, 'error-handling');
    assert.ok(findings[0]!.title.includes('Go error propagation'));
  });

  test('16. End-to-End: LogicWatchdogEngine integrates with WorkspaceManager and returns Findings', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-watchdog-e2e-'));

    try {
      const rootUri = vscode.Uri.file(tempDir);
      (vscode.workspace as any).workspaceFolders = [
        { uri: rootUri, name: 'Root', index: 0 },
      ];
      const workspaceManager = new WorkspaceManager(logger);
      const languageRegistry = new LanguageAdapterRegistry(logger);
      languageRegistry.registerBuiltinAdapters();

      const gitService = new GitService(logger);
      const engine = new LogicWatchdogEngine(
        workspaceManager,
        languageRegistry,
        gitService,
        logger
      );

      const filePath = path.join(tempDir, 'controller.ts');
      const fileUri = vscode.Uri.file(filePath);

      // Seed previous content with authentication guard
      const oldCode = `
import { authMiddleware } from './auth';
export function secureEndpoint() {
  authMiddleware();
  doSensitiveOperation();
}
`;
      engine.seedContentCache(fileUri, oldCode);

      // Current content on disk has the guard removed
      const newCode = `
export function secureEndpoint() {
  doSensitiveOperation();
}
`;
      fs.writeFileSync(filePath, newCode);

      const findings = await engine.analyze({
        workspaceRoots: workspaceManager.getRoots(),
        targetUris: [fileUri],
      });

      assert.strictEqual(findings.length, 1);
      const f = findings[0]!;
      assert.strictEqual(f.category, 'logic-risk');
      assert.strictEqual(f.severity, 'error');
      assert.strictEqual(f.confidence, 'high');
      assert.strictEqual(f.sourceEngine, 'agentguard.logic-watchdog');
      assert.ok(f.title.includes('Authentication'));
      assert.ok(f.evidence.includes('authMiddleware'));
      assert.ok(f.explanation.includes('Removing authentication checks'));
      assert.strictEqual(f.location.filePath, 'controller.ts');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
