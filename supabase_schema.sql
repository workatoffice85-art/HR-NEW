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
