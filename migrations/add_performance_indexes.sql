-- Performance Indexes for HR System
-- These indexes will significantly improve query performance

-- Attendance table indexes
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance("employeeId");
CREATE INDEX IF NOT EXISTS idx_attendance_check_in ON attendance("checkIn");
CREATE INDEX IF NOT EXISTS idx_attendance_check_out ON attendance("checkOut");
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance("status");
CREATE INDEX IF NOT EXISTS idx_attendance_employee_checkin ON attendance("employeeId", "checkIn");
CREATE INDEX IF NOT EXISTS idx_attendance_employee_checkout ON attendance("employeeId", "checkOut");
CREATE INDEX IF NOT EXISTS idx_attendance_date_range ON attendance("checkIn", "checkOut");

-- Site requests indexes
CREATE INDEX IF NOT EXISTS idx_site_requests_employee_id ON "siteRequests"("employeeId");
CREATE INDEX IF NOT EXISTS idx_site_requests_status ON "siteRequests"("status");
CREATE INDEX IF NOT EXISTS idx_site_requests_timestamp ON "siteRequests"("timestamp");
CREATE INDEX IF NOT EXISTS idx_site_requests_employee_status ON "siteRequests"("employeeId", "status");

-- Allowance requests indexes
CREATE INDEX IF NOT EXISTS idx_allowance_requests_employee_id ON "allowanceRequests"("employeeId");
CREATE INDEX IF NOT EXISTS idx_allowance_requests_status ON "allowanceRequests"("status");
CREATE INDEX IF NOT EXISTS idx_allowance_requests_attendance_id ON "allowanceRequests"("attendanceId");
CREATE INDEX IF NOT EXISTS idx_allowance_requests_created_at ON "allowanceRequests"("createdAt");
CREATE INDEX IF NOT EXISTS idx_allowance_requests_employee_status ON "allowanceRequests"("employeeId", "status");

-- Official holidays indexes
CREATE INDEX IF NOT EXISTS idx_official_holidays_date ON official_holidays("holidayDate");

-- Employees indexes
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_phone ON employees(phone);
CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role);

-- Sites indexes
CREATE INDEX IF NOT EXISTS idx_sites_is_temporary ON sites("isTemporary");

-- Settings indexes
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings("key");

-- Site allowances indexes
CREATE INDEX IF NOT EXISTS idx_site_allowances_employee_id ON "siteAllowances"("employeeId");
CREATE INDEX IF NOT EXISTS idx_site_allowances_site_id ON "siteAllowances"("siteId");

-- Approval logs indexes
CREATE INDEX IF NOT EXISTS idx_approval_logs_request_id ON "approvalLogs"("requestId");
CREATE INDEX IF NOT EXISTS idx_approval_logs_timestamp ON "approvalLogs"("timestamp");
