-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- DATABASE TABLES
-- ============================================

-- Table: employees
CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    phone TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    "assignedSites" TEXT,
    "faceDescriptor" TEXT, -- DEPRECATED: use biometricData instead
    "biometricType" TEXT DEFAULT 'face', -- 'face' (camera), 'fingerprint' (hardware), 'face_hardware' (Face ID)
    "biometricData" TEXT, -- JSON string: face descriptor OR WebAuthn credential ID
    "transportPrice" NUMERIC DEFAULT 0,
    salary NUMERIC DEFAULT 0
);

-- Table: sites
CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    latitude NUMERIC,
    longitude NUMERIC,
    radius NUMERIC DEFAULT 20,
    "transportPrice" NUMERIC DEFAULT 0,
    "mapLink" TEXT,
    "isTemporary" BOOLEAN DEFAULT FALSE
);

-- Table: siteAllowances
CREATE TABLE IF NOT EXISTS "siteAllowances" (
    "employeeId" TEXT REFERENCES employees(id) ON DELETE CASCADE,
    "siteId" TEXT,
    "transportPrice" NUMERIC DEFAULT 0,
    PRIMARY KEY ("employeeId", "siteId")
);

-- Table: siteRequests
CREATE TABLE IF NOT EXISTS "siteRequests" (
    id TEXT PRIMARY KEY DEFAULT ('REQ'::text || upper(substr(md5(random()::text), 1, 8))),
    "employeeId" TEXT REFERENCES employees(id) ON DELETE CASCADE,
    "employeeName" TEXT,
    latitude NUMERIC,
    longitude NUMERIC,
    "suggestedName" TEXT,
    "mapLink" TEXT,
    status TEXT DEFAULT 'pending',
    timestamp TEXT, -- Keeping ISO string as text to match old format
    "transportPrice" NUMERIC,
    note TEXT,
    "receiptUrl" TEXT,
    "receiptName" TEXT,
    "tempRadius" NUMERIC,
    "approvedAt" TEXT,
    "mapLatitude" NUMERIC,
    "mapLongitude" NUMERIC,
    "autoMeta" TEXT
);

-- Table: attendance
CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "employeeId" TEXT REFERENCES employees(id) ON DELETE CASCADE,
    "employeeName" TEXT,
    "siteId" TEXT,
    "siteName" TEXT,
    "checkIn" TEXT,
    "checkOut" TEXT,
    latitude NUMERIC,
    longitude NUMERIC,
    status TEXT,
    "totalHours" NUMERIC,
    "transportPrice" NUMERIC,
    "isPaid" BOOLEAN DEFAULT FALSE,
    "paidAmount" NUMERIC DEFAULT 0,
    "paidAt" TEXT,
    "paidBy" TEXT,
    device_id TEXT,
    "penaltyAmount" NUMERIC DEFAULT 0
);

-- Table: settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Table: allowanceRequests
CREATE TABLE IF NOT EXISTS "allowanceRequests" (
    id TEXT PRIMARY KEY DEFAULT ('ALLOW'::text || upper(substr(md5(random()::text), 1, 8))), -- Format: ALLOW12345
    "employeeId" TEXT REFERENCES employees(id) ON DELETE CASCADE,
    "employeeName" TEXT,
    "attendanceId" TEXT,                           -- Related attendance record
    "siteId" TEXT,
    "siteName" TEXT,
    "requestDate" TEXT NOT NULL,
    "amount" NUMERIC NOT NULL,
    "note" TEXT,
    "status" TEXT DEFAULT 'pending',               -- pending, approved, rejected
    "createdAt" TEXT DEFAULT NOW(),
    "approvedAt" TEXT,                             -- When approved
    "approvedBy" TEXT,                             -- HR admin name
    "rejectionReason" TEXT,                        -- Reason for rejection
    "adminNote" TEXT                               -- Admin note / decision comments
);

-- Table: approvalLogs
CREATE TABLE IF NOT EXISTS "approvalLogs" (
    id TEXT PRIMARY KEY DEFAULT ('LOG'::text || upper(substr(md5(random()::text), 1, 8))), -- Format: LOG12345
    "requestId" TEXT REFERENCES "allowanceRequests"(id) ON DELETE CASCADE,
    "adminId" TEXT,
    "adminName" TEXT,
    "action" TEXT,
    "details" TEXT,
    "timestamp" TEXT DEFAULT NOW()
);

-- Table: official_holidays
CREATE TABLE IF NOT EXISTS official_holidays (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "holidayDate" DATE NOT NULL UNIQUE,
    "holidayName" TEXT NOT NULL,
    "createdAt" TEXT DEFAULT NOW()
);

-- Table: leaveRequests
CREATE TABLE IF NOT EXISTS "leaveRequests" (
    id TEXT PRIMARY KEY DEFAULT ('LEAVE'::text || upper(substr(md5(random()::text), 1, 8))), -- Format: LEAVE12345
    "employeeId" TEXT REFERENCES employees(id) ON DELETE CASCADE,
    "employeeName" TEXT NOT NULL,
    "leaveDate" DATE NOT NULL,                     -- Date of leave
    "reason" TEXT NOT NULL,                        -- Reason for leave
    "status" TEXT DEFAULT 'pending',               -- pending, approved, rejected
    "createdAt" TEXT DEFAULT NOW(),
    "approvedAt" TEXT,                             -- When approved
    "approvedBy" TEXT,                             -- HR admin name
    "rejectionReason" TEXT                         -- Reason for rejection
);

-- Table: notifications
CREATE TABLE IF NOT EXISTS "notifications" (
    id TEXT PRIMARY KEY DEFAULT ('NOTIF'::text || upper(substr(md5(random()::text), 1, 8))), -- Format: NOTIF12345
    "userId" TEXT,                                 -- Target user ID (for specific users)
    "userRole" TEXT,                               -- Target role (hr, employee, etc.)
    "title" TEXT NOT NULL,                         -- Notification title
    "message" TEXT NOT NULL,                       -- Notification message
    "type" TEXT NOT NULL,                          -- Notification type: leave_request, site_request, allowance_request, etc.
    "relatedId" TEXT,                              -- Related record ID
    "isRead" BOOLEAN DEFAULT FALSE,               -- Read status
    "createdAt" TEXT DEFAULT NOW(),
    "readAt" TEXT                                  -- When marked as read
);

-- Table: devices
CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_model TEXT,
    os_type TEXT,
    browser_info TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, device_id)
);

-- Table: device_change_requests
CREATE TABLE IF NOT EXISTS device_change_requests (
    id TEXT PRIMARY KEY DEFAULT ('DEV'::text || upper(substr(md5(random()::text), 1, 8))),
    user_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
    user_name TEXT,
    old_device_id TEXT,
    new_device_id TEXT,
    new_device_model TEXT,
    new_os_type TEXT,
    new_browser_info TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    admin_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TEXT,
    processed_by TEXT
);

-- ============================================
-- PERFORMANCE INDEXES
-- ============================================
-- These indexes speed up common queries and reduce database load

-- Attendance indexes (most queried table)
CREATE INDEX IF NOT EXISTS idx_attendance_employeeId ON attendance("employeeId");
CREATE INDEX IF NOT EXISTS idx_attendance_checkIn ON attendance("checkIn");
CREATE INDEX IF NOT EXISTS idx_attendance_employee_checkIn ON attendance("employeeId", "checkIn");
CREATE INDEX IF NOT EXISTS idx_attendance_device_id ON attendance(device_id);

-- Employee indexes
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_phone ON employees(phone);

-- Site requests indexes
CREATE INDEX IF NOT EXISTS idx_siteRequests_employeeId ON "siteRequests"("employeeId");
CREATE INDEX IF NOT EXISTS idx_siteRequests_status ON "siteRequests"(status);
CREATE INDEX IF NOT EXISTS idx_siteRequests_timestamp ON "siteRequests"(timestamp);

-- Allowance requests indexes
CREATE INDEX IF NOT EXISTS idx_allowanceRequests_employeeId ON "allowanceRequests"("employeeId");
CREATE INDEX IF NOT EXISTS idx_allowanceRequests_status ON "allowanceRequests"(status);
CREATE INDEX IF NOT EXISTS idx_allowanceRequests_createdAt ON "allowanceRequests"("createdAt");

-- Site allowances indexes
CREATE INDEX IF NOT EXISTS idx_siteAllowances_employeeId ON "siteAllowances"("employeeId");
CREATE INDEX IF NOT EXISTS idx_siteAllowances_siteId ON "siteAllowances"("siteId");

-- Leave requests indexes
CREATE INDEX IF NOT EXISTS idx_leaveRequests_employeeId ON "leaveRequests"("employeeId");
CREATE INDEX IF NOT EXISTS idx_leaveRequests_status ON "leaveRequests"("status");
CREATE INDEX IF NOT EXISTS idx_leaveRequests_leaveDate ON "leaveRequests"("leaveDate");
CREATE INDEX IF NOT EXISTS idx_leaveRequests_createdAt ON "leaveRequests"("createdAt");

-- Notifications indexes
CREATE INDEX IF NOT EXISTS idx_notifications_userId ON "notifications"("userId");
CREATE INDEX IF NOT EXISTS idx_notifications_userRole ON "notifications"("userRole");
CREATE INDEX IF NOT EXISTS idx_notifications_isRead ON "notifications"("isRead");
CREATE INDEX IF NOT EXISTS idx_notifications_type ON "notifications"("type");
CREATE INDEX IF NOT EXISTS idx_notifications_createdAt ON "notifications"("createdAt");
CREATE INDEX IF NOT EXISTS idx_notifications_relatedId ON "notifications"("relatedId");

-- Device indexes
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);
CREATE INDEX IF NOT EXISTS idx_devices_is_active ON devices(is_active);

-- Device change request indexes
CREATE INDEX IF NOT EXISTS idx_device_change_requests_user_id ON device_change_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_device_change_requests_status ON device_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_device_change_requests_created_at ON device_change_requests(created_at);

-- ============================================
-- DATABASE SIZE MONITORING FUNCTION
-- ============================================
-- This function returns the total database size in bytes

CREATE OR REPLACE FUNCTION get_database_size()
RETURNS BIGINT AS $$
BEGIN
    RETURN (SELECT pg_database_size(current_database()));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_database_size() TO authenticated;
GRANT EXECUTE ON FUNCTION get_database_size() TO anon;

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- RLS Policies for devices
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can see their own devices" ON devices;
CREATE POLICY "Users can see their own devices" 
ON devices FOR SELECT 
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Admins can see all devices" ON devices;
CREATE POLICY "Admins can see all devices" 
ON devices FOR SELECT 
USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid()::text AND role = 'hr'));

-- RLS Policies for device_change_requests
ALTER TABLE device_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can see their own requests" ON device_change_requests;
CREATE POLICY "Users can see their own requests" 
ON device_change_requests FOR SELECT 
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Admins can see all requests" ON device_change_requests;
CREATE POLICY "Admins can see all requests" 
ON device_change_requests FOR SELECT 
USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid()::text AND role = 'hr'));

DROP POLICY IF EXISTS "Users can insert their own requests" ON device_change_requests;
CREATE POLICY "Users can insert their own requests" 
ON device_change_requests FOR INSERT 
WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Admins can update requests" ON device_change_requests;
CREATE POLICY "Admins can update requests" 
ON device_change_requests FOR UPDATE 
USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid()::text AND role = 'hr'));
