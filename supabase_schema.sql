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
    "faceDescriptor" TEXT,
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
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    "transportPrice" NUMERIC,
    note TEXT,
    "receiptUrl" TEXT,
    "receiptName" TEXT,
    "tempRadius" NUMERIC,
    "approvedAt" TIMESTAMPTZ,
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
    "checkIn" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "checkOut" TIMESTAMPTZ,
    latitude NUMERIC,
    longitude NUMERIC,
    status TEXT,
    "totalHours" NUMERIC,
    "transportPrice" NUMERIC,
    note TEXT,
    "overtimeAmount" NUMERIC DEFAULT 0,
    "requestedExtraAmount" NUMERIC DEFAULT 0,
    "extraAmountReason" TEXT,
    "extraAmountStatus" TEXT DEFAULT 'none' -- 'none', 'pending', 'approved', 'rejected'
);

-- Table: holidays
CREATE TABLE IF NOT EXISTS holidays (
    id SERIAL PRIMARY KEY,
    date TEXT UNIQUE NOT NULL, -- Format: YYYY-MM-DD
    name TEXT
);

-- Table: settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

--- SECURITY: ROW LEVEL SECURITY (RLS) ---

-- Enable RLS on all tables
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE "siteAllowances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "siteRequests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- 1. Employees Policies
CREATE POLICY "Employees can view own data" ON employees
    FOR SELECT USING (auth.uid()::text = id);

CREATE POLICY "HR can view all employees" ON employees
    FOR ALL USING (auth.jwt() ->> 'role' = 'hr');

-- 2. Sites Policies
CREATE POLICY "Everyone can view sites" ON sites
    FOR SELECT USING (true);

CREATE POLICY "Only HR can manage sites" ON sites
    FOR ALL USING (auth.jwt() ->> 'role' = 'hr');

-- 3. Attendance Policies
CREATE POLICY "Employees can view own attendance" ON attendance
    FOR SELECT USING (auth.uid()::text = "employeeId");

CREATE POLICY "Employees can insert attendance" ON attendance
    FOR INSERT WITH CHECK (auth.uid()::text = "employeeId");

CREATE POLICY "Employees can update own non-finalized attendance" ON attendance
    FOR UPDATE USING (auth.uid()::text = "employeeId" AND "checkOut" IS NULL);

CREATE POLICY "HR can manage all attendance" ON attendance
    FOR ALL USING (auth.jwt() ->> 'role' = 'hr');

-- 4. Site Requests Policies
CREATE POLICY "Employees can view own requests" ON "siteRequests"
    FOR SELECT USING (auth.uid()::text = "employeeId");

CREATE POLICY "Employees can submit requests" ON "siteRequests"
    FOR INSERT WITH CHECK (auth.uid()::text = "employeeId");

CREATE POLICY "HR can manage all site requests" ON "siteRequests"
    FOR ALL USING (auth.jwt() ->> 'role' = 'hr');

-- 5. Settings Policies
CREATE POLICY "Everyone can view settings" ON settings
    FOR SELECT USING (true);

CREATE POLICY "Only HR can modify settings" ON settings
    FOR ALL USING (auth.jwt() ->> 'role' = 'hr');
