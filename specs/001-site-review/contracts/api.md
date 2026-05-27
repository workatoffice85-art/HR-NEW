# API Validation Contracts: HR Attendance System
# متطلبات التحقق وصحة البيانات في واجهة البرمجة (API)

**Feature Branch**: `001-site-review` | **Date**: 2026-05-27 | **Spec**: [spec.md](./spec.md)

---

## 🛡️ 1. Input Sanitization & Validation Rules (قواعد تعقيم البيانات والتحقق)

All inputs processed by `api/exec.js` must strictly adhere to the following validation constraints:

### 1.1 Email Format (`validateEmail`)
- **RegEx**: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- **Constraint**: Must contain a single `@` sign, characters before and after, followed by a valid top-level domain suffix. Case-insensitive normalization is applied automatically.

### 1.2 Phone Number Normalization (`normalizePhoneValue` / `validatePhone`)
- **Format**: `+201XXXXXXXXX` (Egyptian local format normalized to international format)
- **Constraint**: Input digits are normalized (Eastern Arabic to Western Arabic numerals). Strips whitespace, dashes, parenthetical separators, and handles prefixes (`00` -> `+`, `01` -> `+201`).

### 1.3 Geography Constraints (Geofencing Limits)
- **Latitude**: Must be a decimal number strictly bounded by `[-90, 90]` degrees.
- **Longitude**: Must be a decimal number strictly bounded by `[-180, 180]` degrees.
- **Radius**: Bounded by `(0, 1000]` meters. Rejects values higher than 1km to guarantee geofence precision.

---

## 📡 2. Core Endpoint Payload Standards (معايير طلبات واستجابات الواجهة)

### 2.1 Employee Login (`POST /api/exec?action=login`)
- **Required Fields**:
  - `identifier` (Email or Phone string) - Checked against candidate matching models.
  - `password` (String) - Compared against stored hashes or legacy records.
  - `role` (String) - Roles allowed: `employee` or `hr`.
- **Response Format (200 OK)**:
  ```json
  {
    "success": true,
    "message": "تم تسجيل الدخول بنجاح",
    "data": {
      "id": "EMP1234",
      "name": "أحمد محمد",
      "email": "ahmed@example.com",
      "phone": "+201012345678",
      "role": "employee",
      "biometricType": "face"
    }
  }
  ```

### 2.2 Device Change Request (`POST /api/exec?action=submitDeviceChangeRequest`)
- **Required Fields**:
  - `employeeId` (String)
  - `employeeName` (String)
  - `newDeviceInfo` (Object containing `deviceId`, `deviceModel`, `osType`, `browserInfo`)
- **Constraint**: System restricts duplicate requests by returning `{ "success": false, "message": "لديك طلب تغيير جهاز قيد المراجعة بالفعل" }` if a pending item exists.
