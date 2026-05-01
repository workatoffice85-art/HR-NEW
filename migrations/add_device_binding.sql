-- Migration: Add Device Binding for Hardware Biometric Security
-- This prevents "Buddy Punching" by binding each employee to their registered device

-- Add registeredDeviceId column to employees table
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS "registeredDeviceId" TEXT;

-- Add index for faster device lookups
CREATE INDEX IF NOT EXISTS idx_employees_device_id 
ON employees("registeredDeviceId");

-- Add device tracking to attendance logs (optional - for audit trail)
ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS "deviceId" TEXT;

COMMENT ON COLUMN employees."registeredDeviceId" IS 'Device fingerprint for hardware biometric binding - prevents buddy punching';
COMMENT ON COLUMN attendance."deviceId" IS 'Device used for this attendance record - for audit purposes';
