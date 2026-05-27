<!--
Sync Impact Report:
- Version change: None -> 1.0.0
- List of modified principles:
  * [PRINCIPLE_1_NAME] -> I. Code Quality & Simplicity
  * [PRINCIPLE_2_NAME] -> II. Test-First Discipline
  * [PRINCIPLE_3_NAME] -> III. Consistent User Experience
  * [PRINCIPLE_4_NAME] -> IV. High Performance
  * [PRINCIPLE_5_NAME] -> V. Local-First and Privacy
- Added sections:
  * Development Standards & Constraints
  * Quality Gates & Workflow
- Removed sections: None
- Templates requiring updates:
  * .specify/templates/plan-template.md (✅ updated)
  * .specify/templates/spec-template.md (✅ updated)
  * .specify/templates/tasks-template.md (✅ updated)
- Follow-up TODOs: None
-->

# Photo Organizer Constitution

## Core Principles

### I. Code Quality & Simplicity
Write clean, highly-focused, and readable vanilla JavaScript, HTML, and CSS. Avoid unnecessary third-party libraries and complex frameworks. Code must be easy to read and understand, prioritizing clear, explicit naming and straightforward execution logic.

### II. Test-First Discipline
Write tests first before implementing features (TDD). A minimum of 80% test coverage is required for all core business logic, utility functions, and components. Tests must fail first, then pass once implemented, and be verified in continuous integration.

### III. Consistent User Experience
Deliver a premium, responsive, and animation-rich UI design that is visually appealing and highly interactive. The photo interface should support keyboard navigation, clear states, and smooth drag-and-drop animations without stutter. Ensure consistency across mobile, desktop, and tablet layouts.

### IV. High Performance
Maintain optimal performance with zero layout thrashing, fast page loading, and minimal bundle sizes. Large lists of photo tiles must load efficiently (e.g., via virtualized lists or deferred loading). Drag-and-drop operations should feel fluid and instantaneous at 60 FPS.

### V. Local-First and Privacy
All photo metadata, album lists, sorting order, and file references must reside strictly on the user's local machine. Under no circumstances should user media or metadata be uploaded to external servers or cloud services. Use a local SQLite database for structured data.

## Development Standards & Constraints
- **Core Technology Stack**: Vite, Vanilla HTML5, Vanilla CSS3, Vanilla ECMAScript (JavaScript), SQLite (local database).
- **No Heavy Frameworks**: No React, Vue, Angular, or external UI widget suites. Vanilla web APIs should be preferred for all interactions.
- **Dependencies**: Keep NPM dependencies to an absolute minimum. All dependencies must be vetted for security and performance impact.

## Quality Gates & Workflow
- **Spec-Driven Development (SDD)**: All development must proceed in ordered phases: Specification -> Technical Plan -> Actionable Task List -> Implementation -> Rigorous Test Verification.
- **Security Checkpoints**: Ensure zero remote tracking, prevent SQL injection on SQLite queries, and sanitize all input metadata or file names to prevent XSS.

## Governance
This constitution is the governing document for the Photo Organizer project. Any changes or exceptions to these principles require:
1. Incrementing the Constitution Version (MAJOR.MINOR.PATCH).
2. Documenting the rationale and impact in a Sync Impact Report.
3. Propagating updates across dependent templates and workflows.

**Version**: 1.0.0 | **Ratified**: 2026-05-27 | **Last Amended**: 2026-05-27
