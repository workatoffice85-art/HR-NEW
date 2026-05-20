-- Migration: Add payment tracking columns to attendance table
-- Run this in your Supabase SQL editor

DO $$
BEGIN
    -- Add isPaid column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance' AND column_name = 'isPaid'
    ) THEN
        ALTER TABLE attendance ADD COLUMN "isPaid" BOOLEAN DEFAULT FALSE;
    END IF;
    
    -- Add paidAmount column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance' AND column_name = 'paidAmount'
    ) THEN
        ALTER TABLE attendance ADD COLUMN "paidAmount" NUMERIC DEFAULT 0;
    END IF;
    
    -- Add paidAt column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance' AND column_name = 'paidAt'
    ) THEN
        ALTER TABLE attendance ADD COLUMN "paidAt" TEXT;
    END IF;
    
    -- Add paidBy column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance' AND column_name = 'paidBy'
    ) THEN
        ALTER TABLE attendance ADD COLUMN "paidBy" TEXT;
    END IF;
END $$;
