# SQL Queries for HR System

This document contains common SQL queries for the new tables: leaveRequests, allowanceRequests, notifications

---

## 🏖️ Leave Requests Queries

### Get all pending leave requests
```sql
SELECT * FROM "leaveRequests" 
WHERE status = 'pending' 
ORDER BY "createdAt" DESC;
```

### Get leave requests for specific employee
```sql
SELECT * FROM "leaveRequests" 
WHERE "employeeId" = 'EMP001' 
ORDER BY "leaveDate" DESC;
```

### Get leave requests in date range
```sql
SELECT * FROM "leaveRequests" 
WHERE "leaveDate" BETWEEN '2026-05-01' AND '2026-05-31'
ORDER BY "leaveDate" ASC;
```

### Approve leave request
```sql
UPDATE "leaveRequests" 
SET status = 'approved', 
    "approvedAt" = NOW(), 
    "approvedBy" = 'HR Admin Name'
WHERE id = 'LEAVE12345';
```

### Reject leave request
```sql
UPDATE "leaveRequests" 
SET status = 'rejected', 
    "rejectionReason" = 'Insufficient notice period'
WHERE id = 'LEAVE12345';
```

### Leave request statistics
```sql
SELECT 
    status,
    COUNT(*) as count,
    COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as percentage
FROM "leaveRequests" 
GROUP BY status;
```

---

## 💰 Allowance Requests Queries

### Get all pending allowance requests
```sql
SELECT * FROM "allowanceRequests" 
WHERE status = 'pending' 
ORDER BY "createdAt" DESC;
```

### Get allowance requests for specific employee
```sql
SELECT * FROM "allowanceRequests" 
WHERE "employeeId" = 'EMP001' 
ORDER BY "createdAt" DESC;
```

### Get total allowance amount per employee
```sql
SELECT 
    "employeeId",
    "employeeName",
    SUM(amount) as total_requested,
    COUNT(*) as request_count,
    SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) as total_approved
FROM "allowanceRequests" 
GROUP BY "employeeId", "employeeName"
ORDER BY total_requested DESC;
```

### Approve allowance request
```sql
UPDATE "allowanceRequests" 
SET status = 'approved', 
    "adminNote" = 'Approved for extra work hours'
WHERE id = 'ALLOW12345';
```

### Get monthly allowance requests
```sql
SELECT 
    DATE_TRUNC('month', "createdAt") as month,
    COUNT(*) as request_count,
    SUM(amount) as total_amount
FROM "allowanceRequests" 
GROUP BY DATE_TRUNC('month', "createdAt")
ORDER BY month DESC;
```

---

## 🔔 Notifications Queries

### Get unread notifications for HR
```sql
SELECT * FROM "notifications" 
WHERE "userRole" = 'hr' AND "isRead" = FALSE 
ORDER BY "createdAt" DESC;
```

### Get unread notifications for specific user
```sql
SELECT * FROM "notifications" 
WHERE "userId" = 'EMP001' AND "isRead" = FALSE 
ORDER BY "createdAt" DESC;
```

### Get notifications by type
```sql
SELECT * FROM "notifications" 
WHERE "type" = 'leave_request' 
ORDER BY "createdAt" DESC;
```

### Mark notification as read
```sql
UPDATE "notifications" 
SET "isRead" = TRUE, "readAt" = NOW() 
WHERE id = 'NOTIF12345';
```

### Mark all notifications as read for user
```sql
UPDATE "notifications" 
SET "isRead" = TRUE, "readAt" = NOW() 
WHERE "userId" = 'EMP001' AND "isRead" = FALSE;
```

### Mark all notifications as read for role
```sql
UPDATE "notifications" 
SET "isRead" = TRUE, "readAt" = NOW() 
WHERE "userRole" = 'hr' AND "isRead" = FALSE;
```

### Get notification statistics
```sql
SELECT 
    "type",
    COUNT(*) as total,
    COUNT(CASE WHEN "isRead" = FALSE THEN 1 END) as unread
FROM "notifications" 
GROUP BY "type"
ORDER BY total DESC;
```

### Delete old read notifications (cleanup)
```sql
DELETE FROM "notifications" 
WHERE "isRead" = TRUE 
AND "createdAt" < NOW() - INTERVAL '30 days';
```

---

## 📊 Dashboard Queries

### Get dashboard statistics
```sql
SELECT 
    (SELECT COUNT(*) FROM "leaveRequests" WHERE status = 'pending') as pending_leaves,
    (SELECT COUNT(*) FROM "allowanceRequests" WHERE status = 'pending') as pending_allowances,
    (SELECT COUNT(*) FROM "notifications" WHERE "userRole" = 'hr' AND "isRead" = FALSE) as unread_hr_notifications,
    (SELECT COUNT(*) FROM "siteRequests" WHERE status = 'pending') as pending_site_requests;
```

### Get employee activity summary
```sql
SELECT 
    e."employeeId",
    e."employeeName",
    COUNT(DISTINCT lr.id) as leave_requests_count,
    COUNT(DISTINCT ar.id) as allowance_requests_count,
    COUNT(DISTINCT sr.id) as site_requests_count
FROM employees e
LEFT JOIN "leaveRequests" lr ON e.id = lr."employeeId"
LEFT JOIN "allowanceRequests" ar ON e.id = ar."employeeId"
LEFT JOIN "siteRequests" sr ON e.id = sr."employeeId"
GROUP BY e."employeeId", e."employeeName"
ORDER BY leave_requests_count DESC;
```

### Get recent activity for dashboard
```sql
(
    SELECT 'leave_request' as activity_type, "createdAt", "employeeName", 
           'طلب إجازة جديد' as description
    FROM "leaveRequests" 
    WHERE status = 'pending'
    ORDER BY "createdAt" DESC LIMIT 5
)
UNION ALL
(
    SELECT 'allowance_request' as activity_type, "createdAt", "employeeName", 
           'طلب زيادة بدلات' as description
    FROM "allowanceRequests" 
    WHERE status = 'pending'
    ORDER BY "createdAt" DESC LIMIT 5
)
UNION ALL
(
    SELECT 'site_request' as activity_type, "timestamp" as "createdAt", "employeeName", 
           'طلب موقع جديد' as description
    FROM "siteRequests" 
    WHERE status = 'pending'
    ORDER BY "timestamp" DESC LIMIT 5
)
ORDER BY "createdAt" DESC LIMIT 10;
```

---

## 🔍 Search and Filter Queries

### Search leave requests by reason
```sql
SELECT * FROM "leaveRequests" 
WHERE "reason" ILIKE '%سفر%' 
ORDER BY "createdAt" DESC;
```

### Get leave requests in specific date range for reporting
```sql
SELECT 
    "employeeName",
    "leaveDate",
    "reason",
    "status",
    "createdAt",
    CASE 
        WHEN "status" = 'approved' THEN '✅ موافق'
        WHEN "status" = 'rejected' THEN '❌ مرفوض'
        ELSE '⏳ في الانتظار'
    END as status_ar
FROM "leaveRequests" 
WHERE "leaveDate" BETWEEN '2026-01-01' AND '2026-12-31'
ORDER BY "leaveDate" DESC;
```

### Get high-value allowance requests
```sql
SELECT * FROM "allowanceRequests" 
WHERE amount > 200 
ORDER BY amount DESC;
```

---

## 📈 Analytics Queries

### Monthly leave trends
```sql
SELECT 
    DATE_TRUNC('month', "leaveDate") as month,
    COUNT(*) as total_requests,
    COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
    COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
FROM "leaveRequests" 
GROUP BY DATE_TRUNC('month', "leaveDate")
ORDER BY month DESC;
```

### Allowance requests by amount ranges
```sql
SELECT 
    CASE 
        WHEN amount <= 50 THEN '0-50'
        WHEN amount <= 100 THEN '51-100'
        WHEN amount <= 200 THEN '101-200'
        ELSE '200+'
    END as amount_range,
    COUNT(*) as count,
    SUM(amount) as total_amount
FROM "allowanceRequests" 
GROUP BY 
    CASE 
        WHEN amount <= 50 THEN '0-50'
        WHEN amount <= 100 THEN '51-100'
        WHEN amount <= 200 THEN '101-200'
        ELSE '200+'
    END
ORDER BY MIN(amount);
```

### Notification engagement rates
```sql
SELECT 
    "type",
    COUNT(*) as total_sent,
    COUNT(CASE WHEN "isRead" = TRUE THEN 1 END) as read_count,
    ROUND(COUNT(CASE WHEN "isRead" = TRUE THEN 1 END) * 100.0 / COUNT(*), 2) as read_percentage
FROM "notifications" 
GROUP BY "type"
ORDER BY total_sent DESC;
