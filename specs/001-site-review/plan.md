# Implementation Plan: HR Attendance System Site Review
# خطة التنفيذ التقنية: مراجعة شاملة لنظام الحضور والانصراف

**Branch**: `001-site-review` | **Date**: 2026-05-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-site-review/spec.md`

---

## Summary
## ملخص الخطة التقنية

We will conduct a comprehensive audit of the entire HR Attendance System code repository. The audit will cover frontend files (`employee/`, `hr/`, `index.html`, `assets/`), backend APIs (`api/exec.js`, `api/archive.js`, `api/sync.js`), and database configurations (`supabase_schema.sql`).

Our analysis will focus on:
1. **Security**: Sanitization checks, XSS/SQLi prevention, and cryptographic email token integrity.
2. **UX & Responsive RTL Design**: Layout alignment, Arabic typography, and mobile/desktop responsiveness.
3. **Performance & Caching**: Cache verification (localStorage SWR and backend in-memory cache) and resource loading optimization.
4. **Code Quality**: Modular architecture, clear error handling, and robust biometric flow fallback.

---

## Technical Context
## السياق التقني والمنهجية

**Languages/Versions**: HTML5, CSS3, ES Modules JavaScript, Node.js, PostgreSQL/Supabase SQL.

**Primary Directories to Audit**:
- `c:\Users\Demo\Desktop\HR DEMO\HR-NEW\employee/` (Employee portal)
- `c:\Users\Demo\Desktop\HR DEMO\HR-NEW\hr/` (HR panel)
- `c:\Users\Demo\Desktop\HR DEMO\HR-NEW\api/` (Backend serverless routes)
- `c:\Users\Demo\Desktop\HR DEMO\HR-NEW\assets/` (Shared stylesheets & icons)

**Audit Methodology**:
1. **Static Analysis**: Walkthrough critical sections of JS files to detect raw innerHTML usages, missing sanitization steps on fetches, or unhandled promise rejections.
2. **Security & Cryptographic Check**: Verify HMAC signature logic in `api/exec.js` and the token validity check.
3. **Responsive Visual Testing**: Run device emulator checks on mobile port views.
4. **Supabase & Caching Evaluation**: Match table indexing designs against actual queries executed in `exec.js`.

---

## Constitution Check
## مطابقة الدستور

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **مبدأ الخصوصية والأمان البيومتري**: ✅ مطابِق. التحقق من تشفير البصمات وتأمين البيانات المشفرة قبل الاتصال بـ Supabase.
- **مبدأ دعم العربية والتصميم المتجاوب**: ✅ مطابِق. فحص اتجاه RTL والتجاوب الكامل مع الهواتف في صفحات الموظفين والـ HR.
- **مبدأ النطاق الجغرافي والتحقق المحكم**: ✅ مطابِق. مراجعة كود التحقق من الموقع (Geofence) والمسافات المحتسبة للحدود الجغرافية.
- **مبدأ كفاءة الأداء والتخزين الذكي**: ✅ مطابِق. التحقق من كفاءة كاش SWR وتقليل الطلبات المباشرة للـ API.
- **المنهجية القائمة على المواصفات**: ✅ مطابِق. نطبق نفس دورة مواصفات SDD لإجراء المراجعة بالكامل.

---

## Project Structure
## هيكل المراجعة والتوثيق

All audit artifacts and results will reside strictly in the Spec Kit directory structure:

```text
specs/001-site-review/
├── plan.md              # This file
├── research.md          # Vulnerability & UI/UX analysis findings
├── data-model.md        # Database schema index audit report
├── quickstart.md        # How to run test tools and check parameters
├── contracts/
│   └── api.md           # API endpoint input-validation constraints
└── checklists/
    └── requirements.md  # Review status checklist
```

---

## Implementation Strategy
## استراتيجية المراجعة والتنفيذ

### Phase 0: Setup & Background Verification
- Scan files to check structure.
- Audit database schema columns and indexes.

### Phase 1: Security & API Integrity Review
- Scan backend files (`api/exec.js`, `api/archive.js`) for sanitization vulnerabilities.
- Review cryptography logic and rate limiter thresholds.

### Phase 2: Frontend UX & RTL Consistency Review
- Audit HTML structures (`employee/index.html`, `hr/index.html`, root `index.html`) for CSS links, Tajawal font loading, and responsive styles.
- Verify biometric loading speeds and user interface indicators.

### Phase 3: Consolidation & Remediation Plan
- Formulate a detailed report (`research.md`) documenting all discovered findings with recommendations.
- Present a tasks list to execute high-priority fixes.
