## Description
A concise summary of changes introduced in this pull request and the motivation behind them.

Fixes #(issue number, if applicable)

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Performance improvement

## Architectural & Offline Checklist
- [ ] **Offline Boundary**: Absolutely no remote API calls, analytics, or outbound telemetry added.
- [ ] **Zero Configuration**: Functionality works automatically without mandatory user setup.
- [ ] **Language Independence**: Core engine and findings remain decoupled from language-specific ASTs.
- [ ] **Strict Typing**: Code compiles cleanly under TypeScript strict mode (`npm run compile`).
- [ ] **Resource Disposal**: All watchers, disposables, intervals, and subscriptions are managed via `DisposableStore` or registered in extension context subscriptions.

## Testing Performed
- [ ] All unit tests pass: `npm test`
- [ ] All integration tests pass: `npm run test:integration`
- [ ] Added automated tests for new positive and negative cases.
- [ ] Tested on multi-root workspace (if applicable).
- [ ] Verified on non-Git repository (if applicable).

