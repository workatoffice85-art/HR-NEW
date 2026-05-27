# Technical Research: Photo Organizer

## Core Decisions & Rationale

### 1. Storage: Local SQLite Database via Local Node/Express Backend

- **Decision**: Node.js Express server using the `better-sqlite3` package to query a local `photo_organizer.db` file, and `multer` to save imported photos to a local `backend/uploads/` directory.
- **Rationale**:
  - **Browser Sandbox Limits**: Browsers cannot directly read or write arbitrary files on a user's machine, nor can they establish direct, permanent connections to standard SQLite database files on disk without native extensions (like Tauri/Electron) or a helper local server.
  - **Local-First Consistency**: Running a local Express server on `localhost` solves this sandboxing limit perfectly. It allows true local filesystem storage (copying imported photos to a local directory) and true SQLite database operations.
  - **Offline/No-Cloud Guarantee**: The server runs entirely locally. It does not contact any external API or cloud service, guaranteeing 100% data privacy.
- **Alternatives Considered**:
  - *Browser `sql.js` (SQLite WASM) + IndexedDB*: Allows running SQLite in the browser. However, photo files must be stored as huge BLOBs inside IndexedDB (which is subject to browser-controlled storage quotas and potential automatic eviction) or referenced by browser-selected paths that change or break. Saving actual files to a dedicated folder via a local backend is much more reliable and robust for a permanent photo collection.

### 2. User Interface: Native Drag and Drop HTML5 API & Vanilla CSS

- **Decision**: Native HTML5 Drag and Drop API (`draggable="true"`, `dragstart`, `dragover`, `drop` events) styled with Vanilla CSS Custom Properties (Variables) and transition/transform animations.
- **Rationale**:
  - **Aesthetics & Micro-Animations**: Using Vanilla CSS variables allows us to build extremely clean, dynamic glassmorphic card layouts with smooth hover effects, lifting shadows, and scaling transitions.
  - **No Large UI Frameworks**: Aligning with the Constitution, avoiding external libraries keeps the bundle size minuscule and maximizes execution speed.
  - **High Performance**: Native Drag and Drop has excellent performance across all browser engines, enabling smooth 60 FPS transitions without layout shifts.
- **Alternatives Considered**:
  - *Sortable.js*: A very popular drag-and-drop library. While convenient, it adds external dependencies. By implementing a focused, custom drag-and-drop script (~50 lines of vanilla JS), we keep the codebase clean, highly focused, and dependency-free.

### 3. Build & Development System: Vite with Vanilla JS

- **Decision**: Vite with vanilla template (no React/Vue).
- **Rationale**:
  - **Speed**: Vite uses native ES modules during development, providing instant server start and lightning-fast Hot Module Replacement (HMR).
  - **Simplicity**: Keeps the project lightweight, outputting clean, standard static HTML/JS/CSS assets during bundling.
