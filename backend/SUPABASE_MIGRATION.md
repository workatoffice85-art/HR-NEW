# Supabase Backend Migration Guide

This project originally used Google Apps Script as backend. A Supabase starter backend now exists in this repo.

## What was added

- `supabase/migrations/202604080001_init_hr_schema.sql`
  - Creates the core tables: `employees`, `sites`, `attendance`, `settings`, `site_requests`, `otp_codes`.
- `supabase/functions/hr-api/index.ts`
  - Edge Function router that keeps the same `action` API contract used by the current frontend.

## Supported actions in `hr-api`

### GET

- `getEmployees`
- `getSites`
- `getAttendance`
- `getSettings`
- `getSiteRequests`

### POST

- `login`
- `sendOTP`
- `verifyOTP`
- `resolveMapLink`
- `saveEmployee`
- `updateEmployee`
- `deleteEmployee`
- `saveSite`
- `updateSite`
- `deleteSite`
- `updateSettings`
- `addSiteRequest`
- `approveSiteRequest`
- `rejectSiteRequest`
- `addAttendance`
- `checkoutAttendance`
- `createTriggers` (stub)
- `sendManualReport` (stub)
- `sendEmployeeDetailedReport` (stub)

## Deploy steps

1. Create a Supabase project.
2. Run SQL migration in Supabase SQL Editor:
   - `supabase/migrations/202604080001_init_hr_schema.sql`
3. Deploy the Edge Function:

```bash
supabase functions deploy hr-api
```

4. Set environment variables for the function:

```bash
supabase secrets set APP_TIMEZONE=Africa/Cairo
supabase secrets set OTP_DEBUG_MODE=true
supabase secrets set RESEND_API_KEY=<your_resend_api_key>
supabase secrets set OTP_FROM_EMAIL=<verified_sender@your-domain.com>
supabase secrets set OTP_FROM_NAME="HR System"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically in Supabase Edge Functions.

## Frontend endpoint config

Set the frontend API URL in `assets/app-config.js`:

```js
window.APP_CONFIG = {
  API_URL: "https://<your-project-ref>.supabase.co/functions/v1/hr-api",
  SUPABASE_ANON_KEY: "<your-anon-key>"
};
```

If your function enforces JWT verification (default), missing this key will cause:
`Missing authorization header`

## Important notes

- Passwords are currently handled in plain text to preserve compatibility with the existing frontend flow.
- OTP delivery now supports Resend from the Edge Function.
- If `RESEND_API_KEY` / `OTP_FROM_EMAIL` are missing, OTP can still be generated and returned as `debugCode` when `OTP_DEBUG_MODE=true`.
- Email report sending (`sendManualReport`, `sendEmployeeDetailedReport`) is not implemented yet in this starter.
