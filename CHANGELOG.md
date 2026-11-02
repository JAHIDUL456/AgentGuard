# Changelog

All notable changes to the **AgentGuard** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-11-01

### Added
- **Core Monitoring & Change Pipeline (Stage 2)**:
  - Multi-tier file change watcher using VS Code `FileSystemWatcher`, `onDidChangeTextDocument`, and `onDidSaveTextDocument`.
  - Bounded ring `ChangeQueue` with automatic duplicate suppression, event coalescing (e.g. create + delete = net no-op), and backpressure protection.
  - Debounced `ChangeProcessor` with cancellation token propagation on new burst flushes.
  - Safe subprocess execution for Git via `child_process.execFile` with argument arrays (zero shell interpolation).
  - NUL-delimited porcelain status parser and unified diff parser supporting rename detection and line-range extraction.
  - Graceful fallback mode allowing full monitoring when Git is absent or not initialized.

- **Universal Multi-Language Adapter Framework (Stage 3)**:
  - Pluggable adapter architecture isolating adapter failures from extension core.
  - Built-in adapters for 11 programming languages: TypeScript, JavaScript, Python, PHP, C#, Java, Go, Rust, Dart, C, and C++.
  - Explicit capability levels (Level 1: Change Monitoring through Level 5: Deep Semantic Analysis) and declared limitations.
  - Manifest detectors for `package.json`, `tsconfig.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod`, `composer.json`, `pom.xml`, `build.gradle`, `CMakeLists.txt`, `pubspec.yaml`, and `.csproj`.
  - Fault-tolerant AST parsing and symbol extraction.

- **Diagnostic Delta & Untouched File Blast-Radius Analysis (Stage 4)**:
  - Baseline diagnostic capture and differential settler (`DiagnosticSettler`) dynamically settling compiler diagnostics during active edits.
  - Line-drift-resistant diagnostic fingerprinting that ignores line-shift offsets from preceding edits.
  - High-confidence classification: newly introduced compiler/type regressions vs. pre-existing baseline errors.
  - StructuralDiffer detecting deleted symbols, renamed functions, and modified signatures.
  - DependencyGraph tracking file import linkages and finding untouched dependent callers affected by upstream signature changes.

- **Critical Logic & Safety Watchdog (Stage 5)**:
  - Structural AST and line-diff watchdog engine inspecting removed code context.
  - 6 rule categories: Authentication, Authorization, Validation, Error Handling, Security, and Type Safety.
  - Advanced false-positive protection: suppresses alerts on comments, string literals, test files, refactored logic, and renamed equivalents.
  - Multi-language security detection including Python decorators (`@login_required`), Go error checks (`if err != nil`), PHP authorization gates, and CSRF / SQL injection guards.

- **Professional Native VS Code UI (Stage 6)**:
  - Centralized `FindingManager` with cross-engine deduplication by `uri:line:topic`, ranking issues by severity and confidence.
  - Activity Bar shield icon with SVG adapting dynamically via `currentColor` for light, dark, and high-contrast themes.
  - Native `TreeDataProvider` sidebar featuring `STATUS`, `CRITICAL`, `WARNINGS`, `REVIEW`, `LANGUAGES`, and `RECENT ACTIVITY`.
  - Automatic auto-hiding of empty severity sections (`CRITICAL`, `WARNINGS`, `REVIEW`) when finding count is zero.
  - One-click navigation to exact file and line ranges with cursor selection and rich Markdown hover tooltips.
  - Dynamic Status Bar item reflecting `All Clear`, `Issues Detected`, `Analyzing...`, and `Baseline Settling...`.
  - Native VS Code Problems panel publishing via `vscode.languages.createDiagnosticCollection('agentguard')`.

- **Automatic Markdown Handoff & Optimization (Stage 7)**:
  - Automatic `.vscode/agentguard-report.md` generation on finding updates with zero manual user interaction.
  - Standardized AI coding agent handoff instruction prompt for ChatGPT, Claude Code, Cursor, Copilot, and Windsurf.
  - Secret & environment sanitizer (`SecretSanitizer`) redacting AWS keys, GitHub tokens, JWTs, Bearer tokens, private keys, and passwords.
  - Atomic report writes via hidden temp files and content hash change checks to prevent disk thrashing.
  - Full performance optimization: cached Git status (2s TTL), module resolution caching, and 2MB file size safety caps.

- **Release Validation & Open-Source Readiness (Stage 8)**:
  - 6 end-to-end scenario test suites (Scenarios A through F) verifying multi-language, non-git, and multi-root workflows.
  - Full GitHub repository standards: Apache-2.0 License, NOTICE attribution, Security policy, Contributing guide, Bug report and Feature request templates, Pull request template.
  - Comprehensive README with complete language capability matrix, architecture diagrams, and usage guides.
  - Clean VSIX package generation verified through `@vscode/vsce`.
