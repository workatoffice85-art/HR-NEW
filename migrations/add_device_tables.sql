-- ============================================
-- DEVICE BINDING SYSTEM TABLES
-- ============================================

-- Table: devices - Stores registered devices per user
CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_model TEXT,
    os_type TEXT,
    browser_info TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TEXT DEFAULT NOW(),
    updated_at TEXT DEFAULT NOW(),
    UNIQUE(user_id, device_id)
);

-- Table: device_change_requests - Stores requests to change devices
CREATE TABLE IF NOT EXISTS device_change_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    user_name TEXT,
    old_device_id TEXT,
    new_device_id TEXT NOT NULL,
    new_device_model TEXT,
    new_os_type TEXT,
    new_browser_info TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending', -- pending, approved, rejected
    admin_note TEXT,
    created_at TEXT DEFAULT NOW(),
    processed_at TEXT,
    processed_by TEXT
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Device indexes
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);
CREATE INDEX IF NOT EXISTS idx_devices_is_active ON devices(is_active);

-- Device change request indexes
CREATE INDEX IF NOT EXISTS idx_device_change_requests_user_id ON device_change_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_device_change_requests_status ON device_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_device_change_requests_created_at ON device_change_requests(created_at);

-- ============================================
-- ATTENDANCE TABLE MODIFICATION
-- Add device_id column to track which device was used
-- ============================================

-- Add device_id column to attendance table if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance' AND column_name = 'device_id'
    ) THEN
        ALTER TABLE attendance ADD COLUMN device_id TEXT;
    END IF;
END $$;

-- Index for attendance device_id
CREATE INDEX IF NOT EXISTS idx_attendance_device_id ON attendance(device_id);

-- ============================================
-- HELPER FUNCTION: Get device info for user
-- ============================================

CREATE OR REPLACE FUNCTION get_user_device(p_user_id TEXT)
RETURNS TABLE (
    device_id TEXT,
    device_model TEXT,
    os_type TEXT,
    is_active BOOLEAN,
    created_at TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT d.device_id, d.device_model, d.os_type, d.is_active, d.created_at
    FROM devices d
    WHERE d.user_id = p_user_id AND d.is_active = TRUE
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_user_device(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_device(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_device(TEXT) TO service_role;
