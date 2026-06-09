-- Migration: Add penaltyAmount column to attendance table
-- Run this in your Supabase SQL editor

DO $$
BEGIN
    -- Add penaltyAmount column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance' AND column_name = 'penaltyAmount'
    ) THEN
        ALTER TABLE attendance ADD COLUMN "penaltyAmount" NUMERIC DEFAULT 0;
    END IF;
END $$;
