# Implementation Plan: Photo Organizer

**Branch**: `001-photo-organizer` | **Date**: 2026-05-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-photo-organizer/spec.md`

## Summary

The Photo Organizer is a local-first web application designed to help users organize their local photos into separate, date-grouped albums with a highly interactive, drag-and-drop grid interface. The system operates offline, stores metadata in a local SQLite database, and copies imported photos to a local media directory.

We will use **Vite** for the frontend asset bundling and build system. To support local SQLite operations and local file copying (essential due to browser sandboxing limits), we will implement a lightweight, zero-dependency-adjacent **Node.js Express API server** that runs locally. The frontend will communicate with this server using standard REST interfaces.

## Technical Context

**Language/Version**: JavaScript (ES6+), HTML5, CSS3, Node.js (v18+)

**Primary Dependencies**: 
- **Frontend**: Vanilla JS (ES Modules), native HTML5 Drag and Drop API, TailwindCSS (Wait, user says "Avoid using TailwindCSS unless the USER explicitly requests it; in this case, first confirm which TailwindCSS version to use. Use Vanilla CSS for maximum flexibility and control"). So we will use **Vanilla CSS** with CSS Custom Properties (variables) for styling, glassmorphism, and animations!
- **Backend**: Express.js (v4), `better-sqlite3` (SQLite engine), `multer` (for handling local file uploads/copying), `cors` (for cross-origin requests).
- **Testing**: `pytest` or `vitest` / `supertest` for API integration, and vanilla tests for JS functionality.

**Storage**: Local SQLite database file (`photo_organizer.db`), local filesystem directory (`uploads/`) for photo storage.

**Testing**: Jest or Vitest for unit tests, Supertest for backend API testing.

**Target Platform**: Desktop Web Browsers (Chrome, Edge, Safari, Firefox), local-first offline setup.

**Project Type**: Web Application (Express API + Vite Frontend)

**Performance Goals**: 
- Dashboard load time < 300ms for up to 100 albums.
- Drag-and-drop interface running at a solid 60 FPS without layout shifts.
- Fast file copying for large photos (average < 100ms per file).

**Constraints**:
- Fully offline-capable; no remote data storage, tracking, or cloud uploads.
- Maximum local SQLite query latency < 10ms.
- Responsive design supporting mobile and desktop resolutions.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I: Code Quality & Simplicity**: ✅ Met. Using clean, modular vanilla JavaScript, standard CSS, and minimal dependencies.
- **Principle II: Test-First Discipline**: ✅ Met. We will write Vitest unit tests and Supertest integration tests before implementation.
- **Principle III: Consistent User Experience**: ✅ Met. Detailed UI specs with smooth hover effects, custom drag-and-drop animations, and card layouts.
- **Principle IV: High Performance**: ✅ Met. Optimized database queries with indexes and minimal client-side rendering thrashing.
- **Principle V: Local-First and Privacy**: ✅ Met. All data and photos stored locally in `photo_organizer.db` and the `uploads/` folder.

## Project Structure

### Documentation

```text
specs/001-photo-organizer/
├── plan.md              # This file
├── research.md          # Technical research & choices
├── data-model.md        # Database schema and relations
├── quickstart.md        # How to set up and run locally
├── contracts/
│   └── api.md           # API request/response format contracts
└── checklists/
    └── requirements.md  # Specification checklist
```

### Source Code

We will structure the repository inside `my-project` with a clear frontend/backend separation for modularity:

```text
my-project/
├── backend/
│   ├── server.js        # Express application entrypoint
│   ├── database.js      # SQLite connection & migrations setup
│   ├── uploads/         # Local folder where photo files are stored
│   └── tests/
│       └── api.test.js  # Supertest integration tests
├── src/                 # Vite Frontend
│   ├── css/
│   │   └── style.css    # Premium Vanilla CSS (custom properties, glassmorphism)
│   ├── js/
│   │   ├── api.js       # API client service layer
│   │   ├── drag.js      # Custom drag-and-drop controller
│   │   └── main.js      # Frontend entry and orchestrator
│   └── index.html       # Main single page application dashboard
├── package.json         # Main project package manifest
├── vite.config.js       # Vite configuration
└── vitest.config.js     # Vitest configuration
```

**Structure Decision**: Option 2 (Web Application) with custom vanilla JS components to maintain extreme simplicity and low overhead.

## Complexity Tracking

*No constitutional check violations were detected. The architecture represents the simplest possible implementation that satisfies the local database and file storage constraints.*
