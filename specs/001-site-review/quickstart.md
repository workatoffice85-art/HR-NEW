# Quickstart: Auditing & Testing the Site
# دليل البدء السريع: تشغيل أدوات فحص وتدقيق الموقع

**Feature Branch**: `001-site-review` | **Date**: 2026-05-27 | **Spec**: [spec.md](./spec.md)

---

## 🛠️ 1. Verification Checklist (خطوات المراجعة والتحقق)

To perform a complete manual or automated audit, follow these validation steps:

### 1.1 Automated CSS & Layout Checks (فحص التناسق البصري والتجاوب)
1. **Viewport Verification**:
   - Inspect `employee/index.html` and `hr/index.html` to confirm the viewport meta is correctly set to `<meta name="viewport" content="width=device-width, initial-scale=1.0">`.
2. **RTL Formatting Validation**:
   - Verify that the outer-most tags include `dir="rtl"` and `lang="ar"`.
3. **Table Mobile Responsiveness**:
   - Inspect the block table layout transformation in `assets/global.css` at line 348 (`@media (max-width: 768px)`). Verify table columns transition to stacked rows perfectly.

### 1.2 Security Input Validation Testing (فحص تعقيم المدخلات والتوكنات)
1. **HMAC Secure Links Verification**:
   - Verify secure HMAC hash generation under `api/exec.js` is triggered successfully when requests are submitted by examining the server logs on cold/warm requests.
2. **Geofencing & Coordinate Boundary Check**:
   - Input mock coordinate payloads to verify location rejection on `POST /api/exec?action=addAttendance` works flawlessly when outside radius circles.
