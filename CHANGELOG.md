# Changelog

All notable changes to the **AgentGuard** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - Stage 1: Foundation Release

### Added
- **Core Engine Foundation**:
  - Central `AgentGuardEngine` orchestrator with deterministic state transitions (`uninitialized`, `initializing`, `ready`, `analyzing`, `disposed`).
  - Strict resource management via `DisposableStore` and `IDisposable`.
  - Output channel logging provider with configurable log levels.
- **Multi-Root Workspace Awareness**:
  - `WorkspaceManager` tracking active folders, multi-root workspaces, and folder addition/removal events.
- **Monitoring Subsystem**:
  - `ChangeMonitor` foundation coordinating file system watchers and text document change events.
  - Debounce utilities for change coalescing.
- **Git Integration Foundation**:
  - `GitService` abstraction interface and workspace repository detection.
- **Language Adapter Architecture**:
  - Pluggable `LanguageAdapter` contract and `LanguageAdapterRegistry`.
  - Decoupled core engine from language-specific semantics.
- **Analysis Engine Architecture**:
  - Extensible `IAnalysisEngine` contract and `AnalysisEngineRegistry`.
  - Foundation hooks for untouched files, compiler/syntax diagnostics, logic removal, and dependency checks.
- **Finding Management**:
  - In-memory `FindingManager` with severity ranking, categorization, filtering, and query capabilities.
- **VS Code Native UI**:
  - Dedicated Activity Bar container with custom shield icon.
  - Native `Codebase Safety` Tree View (`agentguard.findingsView`) with clean "Waiting for workspace" / "Ready" status items.
  - Status Bar item showing real-time guard state.
  - Output Channel for diagnostic logs.
- **Safety Reporting**:
  - Markdown safety report generator (`agentguard.generateReport`).
- **Repository Standards & CI**:
  - Strict TypeScript configuration.
  - Automated build using `esbuild`.
  - Comprehensive unit test suite covering core components.
  - GitHub Actions CI workflow for compilation, testing, and packaging validation.

