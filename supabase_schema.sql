-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
    id TEXT PRIMARY KEY,
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
    "transportPrice" NUMERIC
);

-- Table: settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Table: allowanceRequests
CREATE TABLE IF NOT EXISTS "allowanceRequests" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "employeeId" TEXT REFERENCES employees(id) ON DELETE CASCADE,
    "employeeName" TEXT,
    "siteId" TEXT,
    "siteName" TEXT,
    "attendanceId" UUID REFERENCES attendance(id) ON DELETE CASCADE,
    "requestDate" TEXT NOT NULL,
    "amount" NUMERIC NOT NULL,
    "note" TEXT,
    "status" TEXT DEFAULT 'pending',
    "adminNote" TEXT,
    "createdAt" TEXT
);

-- Table: approvalLogs
CREATE TABLE IF NOT EXISTS "approvalLogs" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "requestId" UUID REFERENCES "allowanceRequests"(id) ON DELETE CASCADE,
    "adminId" TEXT,
    "adminName" TEXT,
    "action" TEXT,
    "details" TEXT,
    "timestamp" TEXT
);

-- Table: official_holidays
CREATE TABLE IF NOT EXISTS official_holidays (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "holidayDate" DATE NOT NULL UNIQUE,
    "holidayName" TEXT NOT NULL,
    "createdAt" TEXT DEFAULT NOW()
);

-- ============================================
-- PERFORMANCE INDEXES
-- ============================================
-- These indexes speed up common queries and reduce database load

-- Attendance indexes (most queried table)
CREATE INDEX IF NOT EXISTS idx_attendance_employeeId ON attendance("employeeId");
CREATE INDEX IF NOT EXISTS idx_attendance_checkIn ON attendance("checkIn");
CREATE INDEX IF NOT EXISTS idx_attendance_employee_checkIn ON attendance("employeeId", "checkIn");

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
GRANT EXECUTE ON FUNCTION get_database_size() TO service_role;
