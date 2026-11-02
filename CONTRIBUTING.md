# Contributing to AgentGuard

Thank you for your interest in contributing to AgentGuard! AgentGuard is a community-driven, free and open-source codebase safety extension for Visual Studio Code, distributed under the [Apache License, Version 2.0](LICENSE).

We welcome contributions from developers worldwide to make codebase safety faster, more reliable, and universally accessible.

---

## What You Can Do

As an open-source project under Apache-2.0, you are free to:

- **View & Inspect**: Study the entire source code and implementation.
- **Fork & Modify**: Create forks to experiment, adapt, or build upon the architecture.
- **Report Issues**: Submit bug reports and feature requests via [GitHub Issues](https://github.com/agentguard/agentguard/issues).
- **Submit Pull Requests**: Fix defects, add language heuristics, or refine engines.
- **Improve Documentation & Tests**: Enhance guides, write test fixtures, and expand test coverage.
- **Redistribute**: Share and redistribute the software in accordance with Apache-2.0 conditions.

---

## Licensing of Contributions

To keep participation straightforward, **no Contributor License Agreement (CLA) or complex legal onboarding is required**.

In accordance with **Section 5 of the Apache License, Version 2.0**:
> Unless You explicitly state otherwise, any Contribution intentionally submitted for inclusion in the Work by You to the Licensor shall be under the terms and conditions of this License, without any additional terms or conditions.

By submitting a Pull Request or patch for inclusion in AgentGuard, you agree that your contribution is provided under the terms and conditions of the Apache License, Version 2.0.

---

## Development Prerequisites

- **Node.js**: v20.x or higher.
- **npm**: v10.x or higher.
- **Visual Studio Code**: v1.90.0 or higher.
- **Git**: Latest version recommended.

---

## Getting Started

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/<your-username>/AgentGuard.git
   cd AgentGuard
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Verify build and tests**:
   ```bash
   npm run compile
   npm run build
   npm test
   npm run test:integration
   ```

4. **Launch Extension in Debugger**:
   Open the repository in VS Code and press `F5` to start an Extension Development Host window.

---

## Architectural Guidelines

When submitting code changes, adhere to the following architectural rules:

1. **Strict Offline-First Boundary**: Never introduce external network calls, remote dependencies, or telemetry.
2. **Language Independence**: Keep `src/core/` and orchestrators strictly language-agnostic. Language-specific logic belongs in `src/languages/adapters/`.
3. **Deterministic Resource Disposal**: All event listeners, timers, file watchers, and subscriptions must be registered with `DisposableStore` or added to extension subscriptions.
4. **Strict TypeScript**: Do not use `any`. Always provide explicit typings and maintain compatibility with `strict: true` and `noUncheckedIndexedAccess: true`.
5. **Zero Runtime Dependencies**: The core extension ships with zero production dependencies; keep bundling minimal and fast.

---

## Project Branding & Trademarks

As articulated in **Section 6 of the Apache License, Version 2.0**, this license does not grant permission to use the trade names, trademarks, service marks, or product names of the project, except for reasonable and customary use in describing the origin of the Work.

To maintain clarity and protect users:

- **Official Identity**: "AgentGuard" is the project name and identity. You may not claim that modified forks or derived tools are official AgentGuard releases.
- **Logos & Shield Icon**: Do not use the official project logo, shield icon, or branding materials in a manner that misleads users into believing an independent fork or product is officially endorsed by the AgentGuard project or its maintainers.
- **Attribution**: You are free to state that your software is derived from or based on AgentGuard in compliance with Section 4 of the Apache License 2.0.

---

## Open Source Core & Future Ecosystem

The AgentGuard core extension is and will remain free, open source, and accessible to everyone under the Apache License 2.0.

As an Apache-2.0 project, anyone (including community members, organizations, and the project maintainer) may use, modify, distribute, or incorporate the code into commercial or proprietary workflows, provided the conditions of Apache-2.0 are honored. The project maintainer may also independently develop distinct commercial offerings in the future (such as enterprise support, custom integrations, or separate commercial tooling) alongside the open-source core.

---

## Pull Request Checklist

Before submitting a pull request, ensure:

- [ ] `npm run compile` completes with zero TypeScript errors.
- [ ] `npm run build` bundles the extension cleanly.
- [ ] `npm test` passes all unit and integration tests.
- [ ] New features or fixes include automated tests.
- [ ] Documentation has been updated as appropriate.
- [ ] Code adheres to the offline boundary (no remote requests or telemetry).
