# Contributing to AgentGuard

Thank you for your interest in contributing to AgentGuard! AgentGuard is an open-source, offline-first codebase safety extension for VS Code.

---

## Development Prerequisites

- **Node.js**: v20 or higher.
- **npm**: v10 or higher.
- **Visual Studio Code**: v1.90.0 or higher.

---

## Getting Started

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd AgentGuard
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Verify build and tests**:
   ```bash
   npm run build
   npm test
   ```

---

## Architectural Guidelines

When submitting code changes, adhere to the following architectural rules:

1. **Offline-First**: Never introduce external network calls, cloud dependencies, or telemetry.
2. **Language Independence**: Keep `src/core/` and the orchestrator strictly language-agnostic. Language-specific logic belongs in `src/languages/`.
3. **Strict Resource Management**: All event listeners, timers, file watchers, and subscriptions must be registered with `DisposableStore` or added to extension subscriptions.
4. **Strict TypeScript**: Do not use `any`. Always provide explicit typings and maintain compatibility with `strict: true` and `noUncheckedIndexedAccess: true`.
5. **Minimal Dependencies**: Any new dependency must be strictly justified in terms of necessity, footprint, and offline compatibility.

---

## Pull Request Checklist

Before submitting a pull request, ensure:

- [ ] `npm run compile` completes with zero TypeScript errors.
- [ ] `npm run build` bundles the extension cleanly.
- [ ] `npm test` passes all unit and integration tests.
- [ ] New features or fixes include automated tests.
- [ ] Documentation has been updated as appropriate.

