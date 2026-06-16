-- SQL Migration: Add Telegram Integration & Notification Logs

-- 1. Create table for mapping employee_id to telegram_chat_id
CREATE TABLE IF NOT EXISTS employee_telegram (
    employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
    telegram_chat_id TEXT NOT NULL,
    linked_at TIMESTAMPTZ DEFAULT NOW(),
    last_verified_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create table for secure single-use Telegram link tokens with expiration
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
    token TEXT PRIMARY KEY DEFAULT substring(md5(random()::text) from 1 for 16),
    employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes')
);

-- 3. Create table for logging sent notifications
CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
    channel TEXT NOT NULL, -- 'push', 'telegram', 'email'
    notification_type TEXT NOT NULL, -- 'checkin_reminder', 'checkout_reminder', 'test_notification', etc.
    slot TEXT, -- e.g. '08:45', '15:00', '15:30', or 'test'
    status TEXT NOT NULL, -- 'success', 'failed', 'skipped'
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    notification_date DATE NOT NULL DEFAULT CURRENT_DATE
);

-- 4. Create unique index on notification_logs to prevent race conditions & double-sending
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_unique
ON notification_logs (
    employee_id,
    notification_type,
    notification_date,
    slot
);

-- 5. Add preferred notification channel column to employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS preferred_notification_channel TEXT DEFAULT 'both';

-- 6. Add last_seen_at column to push_subscriptions
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();
