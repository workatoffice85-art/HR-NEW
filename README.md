# HR DEMO

## 🆓 Free Tier Forever - Maintenance Guide

This project is configured to stay within Supabase's free tier (500 MB) indefinitely.

### 📊 Current Limits (Free Tier - Nano)
- **Database Size**: 500 MB maximum
- **Bandwidth**: 2 GB/month egress
- **API Requests**: 100 requests/second
- **Storage**: 1 GB included

### 🔄 Automated Maintenance

The system automatically maintains database size through:

#### 1. **Daily Archiving** (3:00 AM UTC)
- Attendance records older than **365 days** are archived to Google Sheets
- Old site requests (90+ days, approved/rejected) are deleted
- Old allowance requests (180+ days, approved/rejected) are deleted

#### 2. **Smart Caching**
- Employees list: 30 seconds cache
- Sites list: 30 seconds cache
- Settings: 1 minute cache
- This reduces API calls to Supabase

#### 3. **Performance Indexes**
All frequently queried columns are indexed:
- `attendance(employeeId, checkIn)` - for attendance queries
- `employees(email, phone)` - for login lookups
- `siteRequests(status, timestamp)` - for admin dashboard
- `allowanceRequests(status, createdAt)` - for request management

### 📈 Monitoring

#### Check Database Status
Call this endpoint from your admin panel:
```
GET /api/exec?action=getDatabaseStats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tables": {
      "attendance": 12500,
      "employees": 45,
      "sites": 12
    },
    "databaseSize": 156.4,
    "freeTierLimit": 500,
    "usagePercent": 31,
    "status": "healthy"  // healthy | warning | critical
  }
}
```

#### Manual Archive Trigger
Force immediate archiving:
```
GET /api/archive?secret=YOUR_SECRET
```

Set `ARCHIVE_CRON_SECRET` in environment variables for security.

### ⚠️ Alerts

| Status | Usage | Action Required |
|--------|-------|-----------------|
| 🟢 Healthy | < 90% (450 MB) | None |
| 🟡 Warning | 90-96% (450-480 MB) | Archive will run more frequently |
| 🔴 Critical | > 96% (480 MB) | Manual intervention needed |

### 🚀 Setup Instructions

1. **Apply Schema with Indexes:**
   ```sql
   -- Run in Supabase SQL Editor
   \i supabase_schema.sql
   ```

2. **Set Environment Variables:**
   ```
   SUPABASE_URL=your-project-url
   SUPABASE_SERVICE_ROLE_KEY=your-service-key
   ARCHIVE_CRON_SECRET=random-secret-string
   ```

3. **Verify Archive Function:**
   The `get_database_size()` function is included in the schema.

### 📝 Best Practices

1. **Monitor monthly** using the stats endpoint
2. **Don't disable** the daily archive cron job
3. **Keep old Google Sheets** as they serve as permanent backup
4. **Use caching** - don't set cache TTL too low
5. **Avoid storing large files** in the database (use storage buckets instead)

### 🔄 Data Retention Policy

| Data Type | Retention | Archive Destination |
|-----------|-----------|---------------------|
| Attendance | 365 days | Google Sheets |
| Site Requests | 90 days (processed only) | Deleted |
| Allowance Requests | 180 days (processed only) | Deleted |
| Employee Data | Forever | Kept in database |
| Sites & Settings | Forever | Kept in database |

---

**With this setup, you should comfortably stay within 200-300 MB even with 50+ employees and daily attendance tracking.**

