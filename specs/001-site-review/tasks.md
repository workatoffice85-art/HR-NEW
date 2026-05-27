# Tasks: HR Attendance System Site Review
# قائمة مهام مراجعة نظام الحضور والانصراف

**Input**: Design documents from `/specs/001-site-review/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Audit checkpoints and structural analysis verifications.

**Organization**: Tasks are grouped by review phases to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Security & API Integrity Review (US1)

**Purpose**: Audit backend validation, injection protection, and HMAC link integrity

- [x] T001 [P] [US1] Audit `@supabase/supabase-js` query parameter safety to prevent SQL injection in `api/exec.js`
- [x] T002 [P] [US1] Validate SHA-256 HMAC cryptographic token signatures and expiration limits inside `api/exec.js`
- [x] T003 [US1] Audit rate limiter IP storage behavior under serverless container recycling limits in `api/exec.js`

---

## Phase 2: Frontend UX & RTL Consistency Review (US2)

**Purpose**: Audit visual layouts, Arabic typography, CSS variable properties, and mobile display structures

- [x] T004 [P] [US2] Verify viewport scaling tags, text alignment properties, and Tajawal font loading inside `employee/index.html` and `hr/index.html`
- [x] T005 [P] [US2] Review high-fidelity table conversions to stacked card blocks on narrow widths inside `assets/global.css`

---

## Phase 3: Performance & Caching Review (US3)

**Purpose**: Audit client SWR cache hit rates and database indexing efficiency

- [x] T006 [P] [US3] Verify client Stale-While-Revalidate caching mechanics and background revalidation in `employee/app.js`
- [x] T007 [P] [US3] Audit relational foreign key columns and composite performance indexes in `supabase_schema.sql`

---

## Phase 4: Audit & Remediation Documentation (Polish)

**Purpose**: Package findings and present recommendations

- [x] T008 [P] Formulate structural audit findings report in `specs/001-site-review/research.md`
- [x] T009 [P] Compile database index mapping evaluation report in `specs/001-site-review/data-model.md`
- [x] T010 [P] Define API validation constraints and endpoints mapping in `specs/001-site-review/contracts/api.md`
- [x] T011 [P] Build manual verification guide in `specs/001-site-review/quickstart.md`
