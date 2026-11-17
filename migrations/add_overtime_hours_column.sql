-- Migration: Add overtimeHours column to attendance table
-- Run this in your Supabase SQL editor if desired (the system will also work seamlessly without it)

DO $$
BEGIN
    -- Add overtimeHours column to attendance table
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance' AND column_name = 'overtimeHours'
    ) THEN
        ALTER TABLE attendance ADD COLUMN "overtimeHours" NUMERIC DEFAULT 0;
    END IF;
END $$;
