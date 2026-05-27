# Tasks: Photo Organizer

**Input**: Design documents from `/specs/001-photo-organizer/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: TDD approach is mandated by the project constitution. Test tasks are included and must be written first to ensure correct validation and coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create project directory structure under `my-project` (`backend`, `src`, `src/css`, `src/js`)
- [ ] T002 Initialize `package.json` with devDependencies (`vite`, `vitest`, `supertest`, `express`, `better-sqlite3`, `multer`, `cors`)
- [ ] T003 [P] Configure `vite.config.js` and `vitest.config.js` for project bundling and testing

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Setup SQLite connection, initial migrations, and index creation in `backend/database.js`
- [ ] T005 [P] Setup base API routing and Express middleware structures (CORS, JSON parser) in `backend/server.js`
- [ ] T006 Ensure uploads storage directories are created on startup in `backend/server.js`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Photo Albums & Tile Preview (Priority: P1) 🎯 MVP

**Goal**: Allow users to create, delete, and view photo albums with photo tiles previewed in a grid view

**Independent Test**: Create an album named "Graduation 2026", upload 4 photos, and verify they render correctly as a tile grid

### Tests for User Story 1 (TDD) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T007 [P] [US1] Write integration tests in `backend/tests/api.test.js` for album CRUD (`POST`, `GET`, `DELETE`) and photo import (`POST`)
- [ ] T008 [P] [US1] Write unit tests in `src/js/api.test.js` for frontend API client actions (`createAlbum`, `getAlbums`, `deleteAlbum`, `uploadPhotos`)

### Implementation for User Story 1

- [ ] T009 [US1] Implement database functions for album CRUD and photo file reference persistence in `backend/database.js`
- [ ] T010 [US1] Implement Express endpoint routes and `multer` file copier service in `backend/server.js`
- [ ] T011 [US1] Implement frontend HTTP query wrapper service in `src/js/api.js`
- [ ] T012 [P] [US1] Implement HTML5 layout structures for album creation dialogue and tile grid wrapper in `src/index.html`
- [ ] T013 [US1] Implement active rendering loop for album dashboard and photo tiles in `src/js/main.js`
- [ ] T014 [P] [US1] Implement base layout CSS styling and premium glassmorphic tile designs in `src/css/style.css`

**Checkpoint**: At this point, User Story 1 is fully functional and testable independently

---

## Phase 4: User Story 2 - Date Grouping (Priority: P2)

**Goal**: Albums are grouped and sorted chronologically by their calendar date on the main page

**Independent Test**: Create three albums with distinct dates and verify they are rendered in separate, sorted date groups on the dashboard

### Tests for User Story 2 (TDD) ⚠️

- [ ] T015 [P] [US2] Write database query tests in `backend/tests/api.test.js` verifying chronological sorting constraints

### Implementation for User Story 2

- [ ] T016 [US2] Update database list query to sort albums by date descending and order index ascending in `backend/database.js`
- [ ] T017 [US2] Implement rendering logic to visually partition album tiles under chronologically grouped date header elements in `src/js/main.js`
- [ ] T018 [P] [US2] Add responsive styling rules for date header groups and grid segments in `src/css/style.css`

**Checkpoint**: At this point, User Stories 1 and 2 are fully functional and integrated

---

## Phase 5: User Story 3 - Drag-and-Drop Album Re-organization (Priority: P3)

**Goal**: Allow users to drag and drop album cards to customize their order within their date group

**Independent Test**: Drag the second album card in a group to the first position, refresh, and verify the order is preserved

### Tests for User Story 3 (TDD) ⚠️

- [ ] T019 [P] [US3] Write reorder API integration test in `backend/tests/api.test.js` validating custom order updates
- [ ] T020 [P] [US3] Write unit tests in `src/js/drag.test.js` checking drag transitions and drag-over index calculation

### Implementation for User Story 3

- [ ] T021 [US3] Implement bulk `sort_order` database update operation in `backend/database.js` and `backend/server.js`
- [ ] T022 [US3] Implement Drag and Drop controller using native HTML5 Drag and Drop event handlers in `src/js/drag.js`
- [ ] T023 [US3] Connect drag event listener triggers to dispatch reordering requests on drop in `src/js/main.js`
- [ ] T024 [P] [US3] Implement drag visual feedback styles (dragging states, drop overlays) in `src/css/style.css`

**Checkpoint**: All user stories are now independently functional and fully implemented

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: High-fidelity UI Polish, manual verification, and codebase packaging

- [ ] T025 [P] Implement lightbox modal in `src/index.html` and preview trigger controls in `src/js/main.js`
- [ ] T026 Add responsive layout support for mobile screens in `src/css/style.css`
- [ ] T027 [P] Update developer documentation and execution instructions in `README.md`
- [ ] T028 Run the complete test runner (`npm run test`) and verify 80%+ code coverage
- [ ] T029 Clean up outstanding debug console prints, unused test files, and optimize static build sizes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion. Blocks all user stories.
- **User Stories (Phase 3+)**: All depend on Foundational completion.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: P1 is the MVP. It does not depend on US2 or US3.
- **User Story 2 (P2)**: Extends US1 rendering, but is testable independently.
- **User Story 3 (P3)**: Extends US1 rendering and US2 reordering, but is testable independently.

---

## Parallel Example: User Story 1

```bash
# Launch test creation tasks:
Task T007: Write integration tests in backend/tests/api.test.js
Task T008: Write unit tests in src/js/api.test.js

# Once tests are failing, implement modules concurrently:
Task T012: Implement HTML5 layout structures in src/index.html
Task T014: Implement base layout CSS styling in src/css/style.css
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Setup project core skeleton (Phase 1).
2. Establish database connection and local API shell (Phase 2).
3. Implement album CRUD + photo preview in grid layout (Phase 3).
4. Run manual integration checks. Verify MVP works locally!

### Incremental Delivery

1. Integrate Date Grouping (Phase 4).
2. Integrate drag-and-drop re-organization within groupings (Phase 5).
3. Final polish, mobile optimizations, and full test suite validation (Phase 6).
