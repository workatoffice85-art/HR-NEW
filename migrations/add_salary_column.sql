-- Migration: Add salary column to employees table
-- Run this in your Supabase SQL editor

-- Add salary column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'employees' AND column_name = 'salary'
    ) THEN
        ALTER TABLE employees ADD COLUMN salary NUMERIC DEFAULT 0;
    END IF;
END $$;

-- Ensure official_holidays table exists
CREATE TABLE IF NOT EXISTS official_holidays (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "holidayDate" DATE NOT NULL UNIQUE,
    "holidayName" TEXT NOT NULL,
    "createdAt" TEXT DEFAULT NOW()
);
