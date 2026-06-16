-- Table: push_subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL,
    expiration_time TEXT,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by employeeId
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_employee_id ON push_subscriptions(employee_id);
