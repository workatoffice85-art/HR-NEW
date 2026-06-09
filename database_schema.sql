-- HR System Database Schema
-- This file contains SQL statements for the new tables: leaveRequests, allowanceRequests, notifications

-- =============================================
-- 1. Leave Requests Table
-- =============================================
CREATE TABLE IF NOT EXISTS leaveRequests (
    id VARCHAR(50) PRIMARY KEY,                    -- Format: LEAVE12345
    employeeId VARCHAR(50) NOT NULL,               -- Foreign key to employees
    employeeName VARCHAR(255) NOT NULL,
    leaveDate DATE NOT NULL,                       -- Date of leave
    reason TEXT NOT NULL,                          -- Reason for leave
    status VARCHAR(20) DEFAULT 'pending',          -- pending, approved, rejected
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approvedAt TIMESTAMP NULL,                     -- When approved
    approvedBy VARCHAR(255) NULL,                 -- HR admin name
    rejectionReason TEXT NULL,                    -- Reason for rejection
    
    -- Indexes for performance
    INDEX idx_leaveRequests_employeeId (employeeId),
    INDEX idx_leaveRequests_status (status),
    INDEX idx_leaveRequests_leaveDate (leaveDate),
    INDEX idx_leaveRequests_createdAt (createdAt)
);

-- =============================================
-- 2. Allowance Requests Table
-- =============================================
CREATE TABLE IF NOT EXISTS allowanceRequests (
    id VARCHAR(50) PRIMARY KEY,                   -- Format: ALLOW12345
    employeeId VARCHAR(50) NOT NULL,              -- Foreign key to employees
    employeeName VARCHAR(255) NOT NULL,
    attendanceId VARCHAR(50) NULL,                -- Related attendance record
    siteId VARCHAR(50) NULL,                      -- Related site
    siteName VARCHAR(255) NULL,
    requestDate DATE NULL,                         -- Date of request
    amount DECIMAL(10,2) NOT NULL,                -- Allowance amount
    note TEXT NULL,                                -- Request notes
    status VARCHAR(20) DEFAULT 'pending',          -- pending, approved, rejected
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approvedAt TIMESTAMP NULL,                     -- When approved
    approvedBy VARCHAR(255) NULL,                 -- HR admin name
    rejectionReason TEXT NULL,                    -- Reason for rejection
    
    -- Indexes for performance
    INDEX idx_allowanceRequests_employeeId (employeeId),
    INDEX idx_allowanceRequests_status (status),
    INDEX idx_allowanceRequests_createdAt (createdAt),
    INDEX idx_allowanceRequests_requestDate (requestDate)
);

-- =============================================
-- 3. Notifications Table
-- =============================================
CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(50) PRIMARY KEY,                   -- Format: NOTIF12345
    userId VARCHAR(50) NULL,                      -- Target user ID (for specific users)
    userRole VARCHAR(20) NULL,                     -- Target role (hr, employee, etc.)
    title VARCHAR(255) NOT NULL,                  -- Notification title
    message TEXT NOT NULL,                         -- Notification message
    type VARCHAR(50) NOT NULL,                    -- Notification type: leave_request, site_request, allowance_request, leave_approved, etc.
    relatedId VARCHAR(50) NULL,                    -- Related record ID
    isRead BOOLEAN DEFAULT FALSE,                  -- Read status
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    readAt TIMESTAMP NULL,                         -- When marked as read
    
    -- Indexes for performance
    INDEX idx_notifications_userId (userId),
    INDEX idx_notifications_userRole (userRole),
    INDEX idx_notifications_isRead (isRead),
    INDEX idx_notifications_type (type),
    INDEX idx_notifications_createdAt (createdAt),
    INDEX idx_notifications_relatedId (relatedId)
);

-- =============================================
-- 4. Foreign Key Constraints (Optional - if you have employees table)
-- =============================================
-- Uncomment these if you have an employees table with id column
/*
ALTER TABLE leaveRequests ADD CONSTRAINT fk_leaveRequests_employeeId 
    FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE allowanceRequests ADD CONSTRAINT fk_allowanceRequests_employeeId 
    FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE;
*/

-- =============================================
-- 5. Sample Data (Optional - for testing)
-- =============================================

-- Sample Leave Requests
INSERT INTO leaveRequests (id, employeeId, employeeName, leaveDate, reason, status) VALUES
('LEAVE12345', 'EMP001', 'أحمد محمد', '2026-05-10', 'سفر للعلاج', 'pending'),
('LEAVE12346', 'EMP002', 'فاطمة علي', '2026-05-15', 'مناسبة عائلية', 'approved'),
('LEAVE12347', 'EMP003', 'محمد خالد', '2026-05-20', 'إجازة سنوية', 'rejected');

-- Sample Allowance Requests
INSERT INTO allowanceRequests (id, employeeId, employeeName, amount, note, status) VALUES
('ALLOW12345', 'EMP001', 'أحمد محمد', 150.00, 'بدلات سفر إضافية', 'pending'),
('ALLOW12346', 'EMP002', 'فاطمة علي', 200.00, 'عمل إضافي', 'approved'),
('ALLOW12347', 'EMP003', 'محمد خالد', 100.00, 'بدلات طوارئ', 'rejected');

-- Sample Notifications
INSERT INTO notifications (id, userId, userRole, title, message, type, relatedId) VALUES
('NOTIF12345', NULL, 'hr', 'طلب إجازة جديد', 'قام الموظف أحمد محمد بطلب إجازة بتاريخ 2026-05-10', 'leave_request', 'LEAVE12345'),
('NOTIF12346', 'EMP001', NULL, 'تمت الموافقة على إجازتك', 'تمت الموافقة على طلب إجازتك بتاريخ 2026-05-15', 'leave_approved', 'LEAVE12346'),
('NOTIF12347', NULL, 'hr', 'طلب زيادة بدلات جديد', 'قام الموظف أحمد محمد بطلب زيادة بدلات بمبلغ 150.00 ج.م', 'allowance_request', 'ALLOW12345');

-- =============================================
-- 6. Common Queries (Examples)
-- =============================================

-- Get all pending leave requests
-- SELECT * FROM leaveRequests WHERE status = 'pending' ORDER BY createdAt DESC;

-- Get leave requests for specific employee
-- SELECT * FROM leaveRequests WHERE employeeId = 'EMP001' ORDER BY leaveDate DESC;

-- Get unread notifications for HR
-- SELECT * FROM notifications WHERE userRole = 'hr' AND isRead = FALSE ORDER BY createdAt DESC;

-- Get unread notifications for specific user
-- SELECT * FROM notifications WHERE userId = 'EMP001' AND isRead = FALSE ORDER BY createdAt DESC;

-- Mark notification as read
-- UPDATE notifications SET isRead = TRUE, readAt = CURRENT_TIMESTAMP WHERE id = 'NOTIF12345';

-- Get statistics for dashboard
-- SELECT 
--     (SELECT COUNT(*) FROM leaveRequests WHERE status = 'pending') as pendingLeaves,
--     (SELECT COUNT(*) FROM allowanceRequests WHERE status = 'pending') as pendingAllowances,
--     (SELECT COUNT(*) FROM notifications WHERE userRole = 'hr' AND isRead = FALSE) as unreadHRNotifications;

-- =============================================
-- 7. Database-Specific Notes
-- =============================================

-- For MySQL/MariaDB:
-- - Use DATETIME instead of TIMESTAMP
-- - Use TINYINT(1) instead of BOOLEAN
-- - Modify index syntax if needed

-- For PostgreSQL:
-- - Use SERIAL for auto-increment if needed
-- - Use TEXT for long strings
-- - Boolean type is supported

-- For SQLite:
-- - Remove DEFAULT CURRENT_TIMESTAMP for some columns
-- - Use INTEGER for boolean values (0/1)

-- For Supabase (PostgreSQL):
-- - This schema should work as-is
-- - Supabase automatically creates primary keys with UUID if preferred

-- =============================================
-- 8. Attendance Table Schema Updates
-- =============================================
-- Run this query to update your attendance table:
-- ALTER TABLE attendance ADD COLUMN IF NOT EXISTS "penaltyAmount" NUMERIC DEFAULT 0;
