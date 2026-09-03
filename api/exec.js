import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';

// Rate limiting storage (in production, use Redis or similar)
const rateLimitStore = new Map();
// Raised to match Supabase free tier: ~100 req/sec per client
const RATE_LIMIT_WINDOW = 1000; // 1 second window
const RATE_LIMIT_MAX_REQUESTS = 100; // max 100 requests per second per IP

// Simple cache for frequently accessed data
const cacheStore = new Map();
const CACHE_TTL = {
    settings: 60000,      // 1 minute for settings
    employees: 30000,     // 30 seconds for employees
    sites: 30000,         // 30 seconds for sites
    holidays: 300000,     // 5 minutes for holidays (rarely change)
    default: 10000        // 10 seconds default
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
});

/**
 * Helper: Fetch all rows from a Supabase table using pagination (bypassing PostgREST 1,000 row default limit)
 */
async function fetchAllRows(table, select = '*', orderColumn = null, ascending = true) {
    const READ_PAGE_SIZE = 1000;
    const rows = [];
    let from = 0;

    while (true) {
        const to = from + READ_PAGE_SIZE - 1;
        let query = supabase.from(table).select(select).range(from, to);
        if (orderColumn) {
            query = query.order(orderColumn, { ascending });
        }
        const { data, error } = await query;
        if (error) {
            console.error(`Error in fetchAllRows for ${table}:`, error);
            throw error;
        }
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < READ_PAGE_SIZE) break;
        from += READ_PAGE_SIZE;
    }
    return rows;
}


// --- Google Sheets Archive Caching Layer ---
const googleSheetsCacheStore = new Map();
const GOOGLE_SHEETS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

async function fetchGoogleSheetsAttendanceWithCache(employeeId = '', startDate = '', endDate = '') {
    const now = Date.now();
    const cacheKey = `${employeeId}_${startDate}_${endDate}`;

    // Clean up expired cache items to prevent memory growth
    for (const [key, value] of googleSheetsCacheStore.entries()) {
        if (now - value.timestamp > GOOGLE_SHEETS_CACHE_TTL) {
            googleSheetsCacheStore.delete(key);
        }
    }

    const cached = googleSheetsCacheStore.get(cacheKey);
    if (cached && (now - cached.timestamp < GOOGLE_SHEETS_CACHE_TTL)) {
        return cached.data;
    }

    try {
        let url = `${GOOGLE_SCRIPT_URL}?action=getDashboardData&t=${now}`;
        if (employeeId) url += `&employeeId=${encodeURIComponent(employeeId)}`;
        if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
        if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;

        const gsRes = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' }
        });
        if (!gsRes.ok) throw new Error(`Google Sheets fetch failed with status ${gsRes.status}`);

        const gsData = await gsRes.json();
        if (!gsData.success) throw new Error(gsData.message || "Failed to fetch Google Sheets dashboard data");

        const attendance = Array.isArray(gsData.attendance) ? gsData.attendance : [];
        googleSheetsCacheStore.set(cacheKey, {
            timestamp: now,
            data: attendance
        });
        return attendance;
    } catch (err) {
        console.error("fetchGoogleSheetsAttendanceWithCache error:", err.message);
        // Fallback to cache if available, even if expired
        if (cached) return cached.data;
        return [];
    }
}

/**
 * Generate a cryptographically signed HMAC token for email approvals
 * @param {string} requestId - The request ID
 * @param {string} action - 'approved' or 'rejected'
 * @param {string} requestType - 'leave' | 'site' | 'allowance' | 'device'
 * @returns {string} - The base64 URL-safe token
 */
function generateSecureToken(requestId, action, requestType, approverEmail = '', expiryMs = null) {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        console.error("Missing SUPABASE_SERVICE_ROLE_KEY for token generation");
        return '';
    }
    const duration = expiryMs || (48 * 60 * 60 * 1000); // Default to 48 hours
    const exp = Date.now() + duration;
    const payload = JSON.stringify({ requestId, action, requestType, approverEmail, exp });
    const signature = crypto
        .createHmac('sha256', SUPABASE_SERVICE_ROLE_KEY)
        .update(payload)
        .digest('hex');

    // Package payload and signature in a URL-safe token
    const tokenObj = { payload, signature };
    return Buffer.from(JSON.stringify(tokenObj)).toString('base64url');
}

/**
 * Verify and decode a cryptographically signed HMAC token
 * @param {string} tokenStr - The token string
 * @returns {Object|null} - The payload object if valid, else null
 */
function verifySecureToken(tokenStr) {
    if (!SUPABASE_SERVICE_ROLE_KEY || !tokenStr) return null;
    try {
        const decodedStr = Buffer.from(tokenStr, 'base64url').toString('utf8');
        const { payload, signature } = JSON.parse(decodedStr);

        // Re-generate signature
        const expectedSignature = crypto
            .createHmac('sha256', SUPABASE_SERVICE_ROLE_KEY)
            .update(payload)
            .digest('hex');

        if (signature !== expectedSignature) {
            console.error("Token verification failed: signature mismatch");
            return null;
        }

        const data = JSON.parse(payload);
        if (Date.now() > data.exp) {
            console.error("Token verification failed: token expired");
            return null;
        }

        return data; // { requestId, action, requestType, exp }
    } catch (e) {
        console.error("Token verification failed: error decoding token", e);
        return null;
    }
}

// Rate limiting middleware
function rateLimiter(ip) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;

    // Clean old entries
    for (const [key, value] of rateLimitStore.entries()) {
        if (value.timestamp < windowStart) {
            rateLimitStore.delete(key);
        }
    }

    const record = rateLimitStore.get(ip) || { count: 0, timestamp: now };

    if (record.timestamp < windowStart) {
        // Reset if outside window
        rateLimitStore.set(ip, { count: 1, timestamp: now });
        return true;
    }

    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
        return false; // Rate limit exceeded
    }

    // Increment count
    record.count += 1;
    rateLimitStore.set(ip, record);
    return true;
}

// Cache helper functions
function getCached(key) {
    const cached = cacheStore.get(key);
    if (!cached) return null;
    if (Date.now() > cached.expiry) {
        cacheStore.delete(key);
        return null;
    }
    return cached.data;
}

function setCached(key, data, ttlMs) {
    cacheStore.set(key, {
        data: data,
        expiry: Date.now() + (ttlMs || CACHE_TTL.default)
    });
}

function invalidateCache(pattern) {
    for (const key of cacheStore.keys()) {
        if (key.includes(pattern)) cacheStore.delete(key);
    }
}

// Input validation functions
function validateEmail(email) {
    if (!email) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.toLowerCase().test(email);
}

function validatePhone(phone) {
    if (!phone) return false;
    // Remove all non-digit characters
    const digitsOnly = phone.replace(/\D/g, '');
    // Egyptian phone numbers: 10-11 digits starting with 01 or +2
    return /^(01\d{9}|20\d{9})$/.test(digitsOnly) || /^\+2\d{10}$/.test(digitsOnly);
}

function validatePassword(password) {
    if (!password) return false;
    // At least 8 characters, containing at least one letter and one number
    return password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password);
}

function validateName(name) {
    if (!name) return false;
    // Allow letters, spaces, hyphens, and apostrophes
    return /^[a-zA-Z\s\-']{2,50}$/.test(name);
}

function validateSiteName(name) {
    if (!name) return false;
    // Allow letters, numbers, spaces, and common punctuation
    return /^[a-zA-Z0-9\s\-_.]{2,100}$/.test(name);
}

function validateLatitude(lat) {
    if (lat === null || lat === undefined) return false;
    const num = parseFloat(lat);
    return !isNaN(num) && num >= -90 && num <= 90;
}

function validateLongitude(lng) {
    if (lng === null || lng === undefined) return false;
    const num = parseFloat(lng);
    return !isNaN(num) && num >= -180 && num <= 180;
}

function validateRadius(radius) {
    if (radius === null || radius === undefined) return false;
    const num = parseFloat(radius);
    return !isNaN(num) && num > 0 && num <= 1000; // Max 1km radius
}

function validateTransportPrice(price) {
    if (price === null || price === undefined) return false;
    const num = parseFloat(price);
    return !isNaN(num) && num >= 0 && num <= 1000; // Reasonable transport price
}

function validateAmount(amount) {
    if (amount === null || amount === undefined) return false;
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0 && num <= 10000; // Reasonable allowance amount
}

// ============================================
// EMAIL NOTIFICATION FUNCTIONS
// ============================================
// 
// EMAIL SENDING VIA GMAILAPP (same as OTP system):
// - Uses Google Apps Script (GmailApp) to send emails
// - No additional email provider needed
// - Requires the Google Script to be deployed and accessible
//
// Make sure GOOGLE_SCRIPT_URL is correctly set in the config above
// ============================================

/**
 * Get notification settings from database
 * Returns: { enabled: boolean, emails: string[] }
 */
async function getNotificationSettings(supabase) {
    try {
        const { data: settings, error } = await supabase
            .from('settings')
            .select('*')
            .in('key', ['notificationEmails', 'requestNotificationsEnabled']);

        if (error) {
            console.error('Error fetching notification settings:', error);
            return { enabled: false, emails: [] };
        }

        const settingsMap = {};
        if (settings) {
            settings.forEach(s => settingsMap[s.key] = s.value);
        }

        const enabled = settingsMap.requestNotificationsEnabled === 'true';
        const emailsStr = settingsMap.notificationEmails || '';
        const emails = emailsStr.split(',').map(e => e.trim()).filter(e => e);

        return { enabled, emails };
    } catch (error) {
        console.error('Exception fetching notification settings:', error);
        return { enabled: false, emails: [] };
    }
}

/**
 * Send email notification using Google Script (GmailApp) - same as OTP system
 * @param {Object} options - { to, subject, html, text }
 */
async function sendEmailNotification(options) {
    const { to, subject, html, text } = options;

    if (!to || to.length === 0) {
        console.log('No recipients for email notification');
        return { success: false, message: 'No recipients' };
    }

    console.log('📧 EMAIL NOTIFICATION:');
    console.log('To:', to.join(', '));
    console.log('Subject:', subject);

    try {
        // Use Google Script to send email via GmailApp (same as OTP)
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'sendNotificationEmail',
                to: to,
                subject: subject,
                body: text,
                htmlBody: html
            }),
            headers: { 'Content-Type': 'text/plain' }
        });

        const result = await response.json();

        if (result.success) {
            console.log('✅ Email sent successfully via GmailApp');
            return { success: true, message: 'Email sent via GmailApp' };
        } else {
            console.error('Failed to send email:', result.message);
            return { success: false, message: result.message };
        }
    } catch (error) {
        console.error('Error sending email via Google Script:', error);
        return { success: false, message: error.message };
    }
}

/**
 * Send request notification email to HR
 * @param {Object} supabase - Supabase client
 * @param {Object} requestData - { type, employeeName, details, requestId }
 */
/**
 * Send request notification email to HR
 * @param {Object} supabase - Supabase client
 * @param {Object} requestData - { type, employeeName, details, requestId }
 * @param {string} host - Host header for generating links
 */
async function sendRequestNotificationEmail(supabase, requestData, host) {
    const settings = await getNotificationSettings(supabase);

    if (!settings.enabled || settings.emails.length === 0) {
        console.log('Request email notifications disabled or no emails configured');
        return { success: false, message: 'Notifications disabled' };
    }

    const { type, employeeName, details, requestId } = requestData;

    const typeLabels = {
        'leave': 'طلب إجازة',
        'site': 'طلب تسجيل موقع',
        'allowance': 'طلب زيادة بدلات',
        'device': 'طلب تغيير جهاز'
    };

    const typeLabel = typeLabels[type] || 'طلب جديد';
    const subject = `نظام الموارد البشرية - ${typeLabel} من ${employeeName}`;

    // Generate secure links
    const hostHeader = host || 'localhost:3000';
    const protocol = hostHeader.includes('localhost') || hostHeader.includes('127.0.0.1') ? 'http' : 'https';
    const baseUrl = `${protocol}://${hostHeader}`;

    const results = [];
    for (const email of settings.emails) {
        const approveToken = generateSecureToken(requestId, 'approved', type, email);
        const rejectToken = generateSecureToken(requestId, 'rejected', type, email);

        const approveLink = `${baseUrl}/confirm-action.html?token=${approveToken}`;
        const rejectLink = `${baseUrl}/confirm-action.html?token=${rejectToken}`;

        const text = `
مرحباً،

تم استلام ${typeLabel} جديد في نظام الموارد البشرية.

الموظف: ${employeeName}
التفاصيل: ${details}

معرف الطلب: ${requestId || 'N/A'}

للموافقة أو الرفض المباشر عبر البريد الإلكتروني، يرجى الضغط على الروابط التالية:
الموافقة: ${approveLink}
الرفض: ${rejectLink}

نظام الموارد البشرية
        `.trim();

        const html = `
<!DOCTYPE html>
<html lang="ar">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${typeLabel}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
        
        .btn-approve {
            transition: all 0.3s ease;
        }
        .btn-approve:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(5, 150, 105, 0.4) !important;
        }
        
        .btn-reject {
            transition: all 0.3s ease;
        }
        .btn-reject:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(220, 38, 38, 0.4) !important;
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #fafafa; font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl;">
    <div dir="rtl" style="max-width: 600px; margin: 30px auto; background-color: #fafafa; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.05); border: 1px solid #eef2f6; padding: 5px;">
        <!-- Modern Premium Accent Bar -->
        <div style="height: 6px; background: linear-gradient(90deg, #6366f1 0%, #a855f7 50%, #ec4899 100%); border-radius: 16px 16px 0 0;"></div>
        
        <!-- White Card Wrapper -->
        <div style="background-color: #ffffff; padding: 35px 25px 25px 25px; border-radius: 0 0 12px 12px;">
            
            <!-- Header -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 25px; direction: rtl;">
                <tr>
                    <td align="right" width="60" style="vertical-align: middle;">
                        <div style="background: #f5f3ff; width: 48px; height: 48px; border-radius: 12px; text-align: center; line-height: 48px; font-size: 16px; font-weight: 800; color: #6366f1; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                            HR
                        </div>
                    </td>
                    <td align="right" style="padding-right: 15px; vertical-align: middle;">
                        <span style="color: #6366f1; font-weight: bold; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px;">نظام الموارد البشرية الذكي</span>
                        <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">${typeLabel} جديد</h2>
                    </td>
                </tr>
            </table>
            
            <!-- Welcome banner -->
            <div style="background-color: #f8fafc; border-right: 4px solid #6366f1; border-radius: 4px 8px 8px 4px; padding: 15px 20px; margin-bottom: 25px;">
                <p style="margin: 0; font-size: 15px; color: #334155; line-height: 1.6; text-align: right;">
                    تم استلام طلب جديد قيد المراجعة والاعتماد. يمكنك اتخاذ الإجراء المباشر بنقرة واحدة أدناه.
                </p>
            </div>

            <!-- Request Details Grid -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-bottom: 25px; border: 1px solid #f1f5f9; border-radius: 12px; overflow: hidden; direction: rtl;">
                <!-- Header Row -->
                <tr style="background-color: #f8fafc;">
                    <td colspan="2" style="padding: 12px 16px; font-weight: 700; font-size: 14px; color: #475569; border-bottom: 1px solid #f1f5f9; text-align: right;">
                        تفاصيل الطلب:
                    </td>
                </tr>
                <!-- Row 1: Employee -->
                <tr>
                    <td width="35%" style="padding: 14px 16px; color: #64748b; font-size: 14px; border-bottom: 1px solid #f8fafc; vertical-align: middle; text-align: right;">
                        <span style="color: #6366f1; margin-left: 6px; font-size: 10px; vertical-align: middle;">●</span> الموظف:
                    </td>
                    <td style="padding: 14px 16px; color: #0f172a; font-weight: 600; font-size: 15px; border-bottom: 1px solid #f8fafc; text-align: right;">
                        ${employeeName}
                    </td>
                </tr>
                <!-- Row 2: Type -->
                <tr>
                    <td style="padding: 14px 16px; color: #64748b; font-size: 14px; border-bottom: 1px solid #f8fafc; vertical-align: middle; text-align: right;">
                        <span style="color: #6366f1; margin-left: 6px; font-size: 10px; vertical-align: middle;">●</span> نوع الطلب:
                    </td>
                    <td style="padding: 14px 16px; color: #6366f1; font-weight: 600; font-size: 15px; border-bottom: 1px solid #f8fafc; text-align: right;">
                        ${typeLabel}
                    </td>
                </tr>
                <!-- Row 3: Date -->
                <tr>
                    <td style="padding: 14px 16px; color: #64748b; font-size: 14px; border-bottom: 1px solid #f8fafc; vertical-align: middle; text-align: right;">
                        <span style="color: #6366f1; margin-left: 6px; font-size: 10px; vertical-align: middle;">●</span> تاريخ الطلب:
                    </td>
                    <td style="padding: 14px 16px; color: #334155; font-size: 14px; border-bottom: 1px solid #f8fafc; text-align: right;">
                        ${new Date().toLocaleDateString('ar-EG')}
                    </td>
                </tr>
                <!-- Row 4: ID -->
                <tr>
                    <td style="padding: 14px 16px; color: #64748b; font-size: 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; text-align: right;">
                        <span style="color: #6366f1; margin-left: 6px; font-size: 10px; vertical-align: middle;">●</span> رقم الطلب:
                    </td>
                    <td style="padding: 14px 16px; color: #475569; font-family: monospace; font-weight: bold; font-size: 14px; border-bottom: 1px solid #f1f5f9; text-align: right;">
                        ${requestId || 'N/A'}
                    </td>
                </tr>
                <!-- Row 5: Details/Notes -->
                <tr>
                    <td colspan="2" style="padding: 18px 16px; background-color: #faf5ff; text-align: right;">
                        <span style="color: #6b21a8; font-weight: bold; font-size: 13px; display: block; margin-bottom: 8px;">
                            <span style="color: #8b5cf6; margin-left: 6px; font-size: 10px; vertical-align: middle;">●</span> الملاحظات / التفاصيل:
                        </span>
                        <div style="color: #3b0764; font-size: 14px; line-height: 1.6; font-weight: 500;">
                            ${details}
                        </div>
                    </td>
                </tr>
            </table>
            
            <!-- Decision Section Header -->
            <div style="text-align: center; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 14px; font-weight: 600; color: #475569;">اتخاذ قرار سريع ومباشر:</p>
            </div>

            <!-- Action Buttons -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="direction: rtl; margin-bottom: 30px;">
                <tr>
                    <td align="center">
                        <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto; width: 100%;">
                            <tr>
                                <!-- Approve Button -->
                                <td align="center" width="50%" style="padding: 5px;">
                                    <a href="${approveLink}" class="btn-approve" target="_blank" style="display: block; padding: 14px 20px; background: linear-gradient(135deg, #059669 0%, #10b981 100%); background-color: #059669; color: #ffffff; font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 15px; font-weight: bold; text-decoration: none; border-radius: 12px; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.25); text-align: center; border: 1px solid #047857;">
                                        ✓ موافقة واعتماد
                                    </a>
                                </td>
                                <!-- Reject Button -->
                                <td align="center" width="50%" style="padding: 5px;">
                                    <a href="${rejectLink}" class="btn-reject" target="_blank" style="display: block; padding: 14px 20px; background: linear-gradient(135deg, #dc2626 0%, #f43f5e 100%); background-color: #dc2626; color: #ffffff; font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 15px; font-weight: bold; text-decoration: none; border-radius: 12px; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.25); text-align: center; border: 1px solid #b91c1c;">
                                        ✕ رفض الطلب
                                    </a>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
            
            <!-- Secure/Expiration Warning Callout -->
            <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; padding: 15px; margin-bottom: 20px; direction: rtl; text-align: right;">
                <table cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                        <td width="20" style="vertical-align: top; font-size: 14px; line-height: 20px; text-align: right; color: #d97706; font-weight: bold;">
                            !
                        </td>
                        <td style="padding-right: 8px; font-size: 12px; color: #b45309; line-height: 1.6; text-align: right;">
                            <strong>إشعار أمان:</strong> هذه روابط معالجة مشفرة وآمنة وصالحة للاستخدام مرة واحدة فقط. تنتهي صلاحية هذه الروابط تلقائياً بعد مرور <strong>48 ساعة</strong> من تاريخ الإرسال.
                        </td>
                    </tr>
                </table>
            </div>

            <div style="text-align: center; border-top: 1px solid #f1f5f9; padding-top: 20px;">
                <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 10px 0;">
                    يمكنك أيضاً مراجعة الطلبات المعلقة وتفاصيلها الكاملة عن طريق تسجيل الدخول إلى 
                    <a href="${baseUrl}" target="_blank" style="color: #6366f1; text-decoration: none; font-weight: bold;">لوحة تحكم نظام الموارد البشرية</a>.
                </p>
            </div>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #f1f5f9; border-radius: 0 0 16px 16px;">
            <p style="margin: 0 0 5px 0; color: #475569; font-size: 12px; font-weight: 600;">
                نظام الموارد البشرية التابع لـ Demo Company
            </p>
            <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                &copy; 2026 جميع الحقوق محفوظة. تم إرسال هذا البريد التلقائي لمديري النظام.
            </p>
        </div>
    </div>
</body>
</html>
        `.trim();

        const res = await sendEmailNotification({
            to: [email],
            subject,
            text,
            html
        });
        results.push(res);
    }

    const allSuccess = results.every(r => r.success);
    return {
        success: allSuccess,
        message: allSuccess ? 'All emails sent' : 'Some emails failed',
        details: results
    };
}

/**
 * Send request reminder notification email to HR
 * @param {Object} supabase - Supabase client
 * @param {Object} requestData - { type, employeeName, details, requestId }
 * @param {string} host - Host header for generating links
 */
async function sendReminderNotificationEmail(supabase, requestData, host) {
    const settings = await getNotificationSettings(supabase);

    if (!settings.enabled || settings.emails.length === 0) {
        console.log('Reminder email notifications disabled or no emails configured');
        return { success: false, message: 'Notifications disabled' };
    }

    const { type, employeeName, details, requestId } = requestData;

    const typeLabels = {
        'leave': 'طلب إجازة',
        'site': 'طلب تسجيل موقع',
        'allowance': 'طلب زيادة بدلات',
        'device': 'طلب تغيير جهاز'
    };

    const typeLabel = typeLabels[type] || 'طلب معلق';
    const subject = `تذكير هام: ${typeLabel} معلق من ${employeeName}`;

    // Generate secure links
    const hostHeader = host || 'localhost:3000';
    const protocol = hostHeader.includes('localhost') || hostHeader.includes('127.0.0.1') ? 'http' : 'https';
    const baseUrl = `${protocol}://${hostHeader}`;

    const results = [];
    for (const email of settings.emails) {
        const approveToken = generateSecureToken(requestId, 'approved', type, email);
        const rejectToken = generateSecureToken(requestId, 'rejected', type, email);

        const approveLink = `${baseUrl}/confirm-action.html?token=${approveToken}`;
        const rejectLink = `${baseUrl}/confirm-action.html?token=${rejectToken}`;

        const text = `
مرحباً،

هذا تذكير بخصوص ${typeLabel} المعلق في نظام الموارد البشرية.

الموظف: ${employeeName}
التفاصيل: ${details}
معرف الطلب: ${requestId || 'N/A'}

للموافقة أو الرفض المباشر عبر البريد الإلكتروني، يرجى الضغط على الروابط التالية:
الموافقة: ${approveLink}
الرفض: ${rejectLink}

نظام الموارد البشرية
        `.trim();

        const html = `
<!DOCTYPE html>
<html lang="ar">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>تذكير: ${typeLabel}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
        
        .btn-approve {
            transition: all 0.3s ease;
        }
        .btn-approve:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(5, 150, 105, 0.4) !important;
        }
        
        .btn-reject {
            transition: all 0.3s ease;
        }
        .btn-reject:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(220, 38, 38, 0.4) !important;
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #fafafa; font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl;">
    <div dir="rtl" style="max-width: 600px; margin: 30px auto; background-color: #fafafa; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.05); border: 1px solid #eef2f6; padding: 5px;">
        <!-- Modern Premium Accent Bar -->
        <div style="height: 6px; background: linear-gradient(90deg, #ec4899 0%, #f59e0b 100%); border-radius: 16px 16px 0 0;"></div>
        
        <!-- White Card Wrapper -->
        <div style="background-color: #ffffff; padding: 35px 25px 25px 25px; border-radius: 0 0 12px 12px;">
            
            <!-- Header -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 25px; direction: rtl;">
                <tr>
                    <td align="right" width="60" style="vertical-align: middle;">
                        <div style="background: #fff5f5; width: 48px; height: 48px; border-radius: 12px; text-align: center; line-height: 48px; font-size: 16px; font-weight: 800; color: #f43f5e; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                            ⏰
                        </div>
                    </td>
                    <td align="right" style="padding-right: 15px; vertical-align: middle;">
                        <span style="color: #f43f5e; font-weight: bold; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px;">تذكير بطلب معلق</span>
                        <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">تذكير: ${typeLabel}</h2>
                    </td>
                </tr>
            </table>
            
            <!-- Details Table -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: separate; border-spacing: 0; border: 1px solid #f1f5f9; border-radius: 12px; overflow: hidden; margin-bottom: 25px; background-color: #ffffff; direction: rtl;">
                <!-- Row 1: Employee Name -->
                <tr>
                    <td width="35%" style="padding: 14px 16px; background-color: #f8fafc; color: #64748b; font-weight: bold; font-size: 14px; border-bottom: 1px solid #f1f5f9; border-left: 1px solid #f1f5f9; text-align: right;">
                        الموظف
                    </td>
                    <td style="padding: 14px 16px; color: #1e293b; font-weight: bold; font-size: 14px; border-bottom: 1px solid #f1f5f9; text-align: right;">
                        ${employeeName}
                    </td>
                </tr>
                <!-- Row 2: Request ID -->
                <tr>
                    <td width="35%" style="padding: 14px 16px; background-color: #f8fafc; color: #64748b; font-weight: bold; font-size: 14px; border-bottom: 1px solid #f1f5f9; border-left: 1px solid #f1f5f9; text-align: right;">
                        معرف الطلب
                    </td>
                    <td style="padding: 14px 16px; color: #475569; font-family: monospace; font-weight: bold; font-size: 14px; border-bottom: 1px solid #f1f5f9; text-align: right;">
                        ${requestId || 'N/A'}
                    </td>
                </tr>
                <!-- Row 3: Details/Notes -->
                <tr>
                    <td colspan="2" style="padding: 18px 16px; background-color: #fffbeb; text-align: right;">
                        <span style="color: #b45309; font-weight: bold; font-size: 13px; display: block; margin-bottom: 8px;">
                            <span style="color: #d97706; margin-left: 6px; font-size: 10px; vertical-align: middle;">●</span> تفاصيل الطلب:
                        </span>
                        <div style="color: #78350f; font-size: 14px; line-height: 1.6; font-weight: 500;">
                            ${details}
                        </div>
                    </td>
                </tr>
            </table>
            
            <!-- Decision Section Header -->
            <div style="text-align: center; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 14px; font-weight: 600; color: #475569;">اتخاذ قرار سريع ومباشر:</p>
            </div>

            <!-- Action Buttons -->
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="direction: rtl; margin-bottom: 30px;">
                <tr>
                    <td align="center">
                        <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto; width: 100%;">
                            <tr>
                                <!-- Approve Button -->
                                <td align="center" width="50%" style="padding: 5px;">
                                    <a href="${approveLink}" class="btn-approve" target="_blank" style="display: block; padding: 14px 20px; background: linear-gradient(135deg, #059669 0%, #10b981 100%); background-color: #059669; color: #ffffff; font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 15px; font-weight: bold; text-decoration: none; border-radius: 12px; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.25); text-align: center; border: 1px solid #047857;">
                                        ✓ موافقة واعتماد
                                    </a>
                                </td>
                                <!-- Reject Button -->
                                <td align="center" width="50%" style="padding: 5px;">
                                    <a href="${rejectLink}" class="btn-reject" target="_blank" style="display: block; padding: 14px 20px; background: linear-gradient(135deg, #dc2626 0%, #f43f5e 100%); background-color: #dc2626; color: #ffffff; font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 15px; font-weight: bold; text-decoration: none; border-radius: 12px; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.25); text-align: center; border: 1px solid #b91c1c;">
                                        ✕ رفض الطلب
                                    </a>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
            
            <!-- Secure/Expiration Warning Callout -->
            <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; padding: 15px; margin-bottom: 20px; direction: rtl; text-align: right;">
                <table cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                        <td width="20" style="vertical-align: top; font-size: 14px; line-height: 20px; text-align: right; color: #d97706; font-weight: bold;">
                            !
                        </td>
                        <td style="padding-right: 8px; font-size: 12px; color: #b45309; line-height: 1.6; text-align: right;">
                            <strong>إشعار أمان:</strong> هذه روابط معالجة مشفرة وآمنة وصالحة للاستخدام مرة واحدة فقط. تنتهي صلاحية هذه الروابط تلقائياً بعد مرور <strong>48 ساعة</strong> من تاريخ الإرسال.
                        </td>
                    </tr>
                </table>
            </div>

            <div style="text-align: center; border-top: 1px solid #f1f5f9; padding-top: 20px;">
                <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 10px 0;">
                    يمكنك أيضاً مراجعة الطلبات المعلقة وتفاصيلها الكاملة عن طريق تسجيل الدخول إلى 
                    <a href="${baseUrl}" target="_blank" style="color: #6366f1; text-decoration: none; font-weight: bold;">لوحة تحكم نظام الموارد البشرية</a>.
                </p>
            </div>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #f1f5f9; border-radius: 0 0 16px 16px;">
            <p style="margin: 0 0 5px 0; color: #475569; font-size: 12px; font-weight: 600;">
                نظام الموارد البشرية التابع لـ Demo Company
            </p>
            <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                &copy; 2026 جميع الحقوق محفوظة. تم إرسال هذا البريد التلقائي لمديري النظام.
            </p>
        </div>
    </div>
</body>
</html>
        `.trim();

        const res = await sendEmailNotification({
            to: [email],
            subject,
            text,
            html
        });
        results.push(res);
    }

    const allSuccess = results.every(r => r.success);
    return {
        success: allSuccess,
        message: allSuccess ? 'All emails sent' : 'Some emails failed',
        details: results
    };
}

// ============================================
// DEVICE VERIFICATION FUNCTIONS
// ============================================

/**
 * Verify device for user attendance
 * Returns: { allowed: boolean, message?: string, deviceRegistered: boolean }
 * 
 * Logic:
 * - If no device registered for user -> Register this device and allow
 * - If device registered and matches -> Allow
 * - If device registered but different -> Reject (needs admin approval)
 */
async function verifyDeviceForAttendance(supabase, userId, deviceId, deviceInfo) {
    try {
        // 1. Check if user has any registered devices
        const { data: userDevices, error: devicesError } = await supabase
            .from('devices')
            .select('*')
            .eq('user_id', userId)
            .eq('is_active', true);

        if (devicesError) {
            console.error('Device verification error:', devicesError);
            return { allowed: false, message: 'خطأ في التحقق من الجهاز', deviceRegistered: false };
        }

        // 2. No device registered - this is the first time
        if (!userDevices || userDevices.length === 0) {
            // Auto-register this device
            const { error: insertError } = await supabase
                .from('devices')
                .insert([{
                    user_id: userId,
                    device_id: deviceId,
                    device_model: deviceInfo?.deviceModel || 'Unknown',
                    os_type: deviceInfo?.osType || 'Unknown',
                    browser_info: deviceInfo?.browserInfo || 'Unknown',
                    is_active: true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }]);

            if (insertError) {
                console.error('Device registration error:', insertError);
                return { allowed: false, message: 'فشل تسجيل الجهاز', deviceRegistered: false };
            }

            return { allowed: true, deviceRegistered: true, isNewDevice: true };
        }

        // 3. Check if current device matches any registered device
        const matchingDevice = userDevices.find(d => d.device_id === deviceId);

        if (matchingDevice) {
            // Device matches - allow attendance
            return { allowed: true, deviceRegistered: true, isNewDevice: false };
        }

        // 4. Device doesn't match - check if there's a pending request
        const { data: pendingRequest, error: requestError } = await supabase
            .from('device_change_requests')
            .select('*')
            .eq('user_id', userId)
            .eq('new_device_id', deviceId)
            .eq('status', 'pending')
            .maybeSingle();

        if (pendingRequest) {
            return {
                allowed: false,
                message: 'طلب تغيير الجهاز قيد المراجعة. يرجى الانتظار موافقة الإدارة.',
                deviceRegistered: true,
                hasPendingRequest: true
            };
        }

        // 5. Device doesn't match and no pending request - reject
        return {
            allowed: false,
            message: 'الجهاز غير معتمد. يرجى طلب تغيير الجهاز من الإدارة.',
            deviceRegistered: true,
            registeredDeviceId: userDevices[0]?.device_id
        };

    } catch (error) {
        console.error('Device verification exception:', error);
        return { allowed: false, message: 'خطأ في التحقق من الجهاز', deviceRegistered: false };
    }
}

/**
 * Create a device change request
 */
async function createDeviceChangeRequest(supabase, userId, userName, oldDeviceId, newDeviceInfo, reason, host) {
    try {
        // Check if there's already a pending request for this user
        const { data: existingRequest } = await supabase
            .from('device_change_requests')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .maybeSingle();

        if (existingRequest) {
            return { success: false, message: 'لديك طلب تغيير جهاز قيد المراجعة بالفعل' };
        }

        const requestId = "DEV" + Math.floor(10000 + Math.random() * 90000);

        const { error } = await supabase
            .from('device_change_requests')
            .insert([{
                id: requestId,
                user_id: userId,
                user_name: userName,
                old_device_id: oldDeviceId,
                new_device_id: newDeviceInfo.deviceId,
                new_device_model: newDeviceInfo.deviceModel || 'Unknown',
                new_os_type: newDeviceInfo.osType || 'Unknown',
                new_browser_info: newDeviceInfo.browserInfo || 'Unknown',
                reason: reason || '',
                status: 'pending',
                created_at: new Date().toISOString()
            }]);

        if (error) {
            console.error('Create device change request error:', error);
            return { success: false, message: 'فشل إنشاء طلب تغيير الجهاز' };
        }

        // Create notification for HR
        await supabase.from('notifications').insert([{
            id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
            userRole: 'hr',
            title: 'طلب اعتماد جهاز (جديد/محدث)',
            message: `الموظف ${userName} يحاول الدخول من معرف جهاز جديد. (قد يكون نفس الجهاز ولكن تم مسح بيانات المتصفح).`,
            type: 'device_change_request',
            relatedId: requestId,
            isRead: false,
            createdAt: new Date().toISOString()
        }]);

        // Send email notification
        await sendRequestNotificationEmail(supabase, {
            type: 'device',
            employeeName: userName,
            details: `الجهاز الجديد: ${newDeviceInfo.deviceModel || 'Unknown'} (${newDeviceInfo.osType || 'Unknown'})${reason ? ' - السبب: ' + reason : ''}`,
            requestId: requestId
        }, host);

        return { success: true, message: 'تم إرسال طلب تغيير الجهاز بنجاح' };
    } catch (error) {
        console.error('Create device change request exception:', error);
        return { success: false, message: 'حدث خطأ أثناء إنشاء الطلب' };
    }
}

// Helper: Distance calculation in meters
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const f1 = lat1 * Math.PI / 180;
    const f2 = lat2 * Math.PI / 180;
    const df = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeString(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function normalizeDigits(value) {
    return String(value)
        .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06F0));
}

function normalizeEmailValue(value) {
    return normalizeString(value).toLowerCase();
}

function normalizePhoneValue(value) {
    let phone = normalizeDigits(normalizeString(value));
    if (!phone) return '';

    phone = phone.replace(/[\u200f\u200e\s-]/g, '');
    phone = phone.replace(/[()]/g, '');

    if (phone.indexOf('00') === 0) {
        phone = `+${phone.substring(2)}`;
    }

    if (phone.indexOf('+') === 0) {
        phone = `+${phone.substring(1).replace(/[^\d]/g, '')}`;
    } else {
        phone = phone.replace(/[^\d]/g, '');
    }

    if (/^01\d{9}$/.test(phone)) {
        phone = `+2${phone}`;
    } else if (/^20\d{10}$/.test(phone)) {
        phone = `+${phone}`;
    }

    return phone;
}

function buildPhoneCandidates(value) {
    const raw = normalizeString(value);
    const candidates = new Set();
    if (raw) candidates.add(raw);

    const onlyDigits = normalizeDigits(raw).replace(/[^\d]/g, '');
    if (onlyDigits) candidates.add(onlyDigits);

    const normalized = normalizePhoneValue(raw);
    if (normalized) {
        candidates.add(normalized);
        candidates.add(normalized.replace(/^\+/, ''));

        const localMatch = normalized.match(/^\+20(1\d{9})$/);
        if (localMatch) {
            candidates.add(`0${localMatch[1]}`);
        }
    }

    return Array.from(candidates).filter(Boolean);
}

// Helper: Get current time in Africa/Cairo timezone for comparisons
function getCairoTime(date = new Date()) {
    return new Date(date.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
}

// Helper: Format date as ISO string in Cairo timezone
function getCairoISOString(date = new Date()) {
    // Get Cairo time components
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    const hour = parts.find(p => p.type === 'hour').value;
    const minute = parts.find(p => p.type === 'minute').value;
    const second = parts.find(p => p.type === 'second').value;

    // Return with Cairo offset
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+02:00`;
}

// Helper: Get time string (HH:mm) in Cairo timezone for comparisons
function getCairoTimeString(date = new Date()) {
    return date.toLocaleTimeString('en-US', {
        timeZone: 'Africa/Cairo',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getCairoDateString(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    return `${year}-${month}-${day}`;
}

// Background sync to Google Sheets (Backup)
async function syncToGoogleSheet(body) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'text/plain' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return res.ok;
    } catch (e) {
        console.error("Google Sync Failed:", e && e.message ? e.message : e);
        return false;
    }
}

export default async function handler(req, res) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({ success: false, message: "Missing Supabase configuration. Please set environment variables." });
    }

    // Add CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Rate limiting
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress || 'unknown';
    if (!rateLimiter(ip)) {
        return res.status(429).json({ success: false, message: "Too many requests. Please try again later." });
    }

    try {
        // Parse the body if POST, or query if GET
        let data = {};
        if (req.method === 'POST') {
            data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } else {
            data = req.query;
        }

        const action = data.action;

        // DUAL WRITING / BACKUP SYNC:
        // For writing actions, we asynchronously broadcast the exact request to your existing Google Apps Script
        // Note: addAttendance and checkoutAttendance sync explicitly after successful DB insert with server timestamps
        const writeActions = [
            "saveEmployee", "updateEmployee", "deleteEmployee",
            "saveSite", "updateSite", "deleteSite",
            "addSiteRequest", "approveSiteRequest", "rejectSiteRequest",
            "updateSettings",
            "addAllowanceRequest", "handleAllowanceRequest",
            "approveLeaveRequest", "rejectLeaveRequest",
            "markNotificationAsRead", "markAllNotificationsAsRead",
            "addOfficialHoliday", "deleteOfficialHoliday",
            "payAttendanceAllowance", "payAttendanceAllowancePeriod", "rollbackAttendanceAllowance", "rollbackAttendanceAllowancePeriod"
        ];
        if (writeActions.includes(action)) {
            await syncToGoogleSheet(data);
        }
        // --- AUTH ---
        if (action === "login") {
            const identifier = normalizeString(data.identifier);
            const password = normalizeString(data.password);
            const role = normalizeString(data.role).toLowerCase();
            const usersById = new Map();
            const addUsers = (rows) => {
                for (const row of (rows || [])) {
                    const key = normalizeString(row.id) || normalizeString(row.email) || normalizeString(row.phone);
                    if (key) usersById.set(key, row);
                }
            };
            if (identifier.includes('@')) {
                const { data: emailUsers, error: emailError } = await supabase
                    .from('employees')
                    .select('*')
                    .eq('email', normalizeEmailValue(identifier));
                if (emailError) throw emailError;
                addUsers(emailUsers);
            }
            const phoneCandidates = buildPhoneCandidates(identifier);
            if (phoneCandidates.length) {
                const { data: phoneUsers, error: phoneError } = await supabase
                    .from('employees')
                    .select('*')
                    .in('phone', phoneCandidates);
                if (phoneError) throw phoneError;
                addUsers(phoneUsers);
            }
            if (usersById.size === 0) {
                const normalizedInputPhone = normalizePhoneValue(identifier);
                if (normalizedInputPhone) {
                    const { data: allUsers, error: allUsersError } = await supabase
                        .from('employees')
                        .select('*');
                    if (allUsersError) throw allUsersError;
                    const fallbackMatches = (allUsers || []).filter(
                        (u) => normalizePhoneValue(u.phone) === normalizedInputPhone
                    );
                    addUsers(fallbackMatches);
                }
            }
            const users = Array.from(usersById.values());
            if (users.length === 0) throw new Error("بيانات الدخول غير صحيحة");

            // Enhanced password verification with hashing support
            let validUser = null;
            for (const user of users) {
                const storedPassword = user.password || '';
                let isValid = false;

                // Check if password is hashed (assuming bcrypt hash starts with $2b$)
                if (storedPassword.startsWith('$2b$')) {
                    // Simulate the same hashing transformation used in saveEmployee
                    const hashedProvidedPassword = password ? `$2b$10${Array(22).fill('0').join('').substring(0, 22)}${password}` : '';
                    isValid = storedPassword === hashedProvidedPassword;
                } else {
                    // Legacy plain text comparison (for backward compatibility)
                    isValid = normalizeString(storedPassword) === password;
                }

                if (isValid) {
                    validUser = user;
                    break;
                }
            }

            const user = validUser;
            if (!user) throw new Error("كلمة المرور غير صحيحة");

            if (role) {
                const userRole = normalizeString(user.role).toLowerCase();
                const reqRole = role.toLowerCase();
                const isHrRole = reqRole === 'hr' && userRole.startsWith('hr');
                if (userRole !== reqRole && !isHrRole) {
                    throw new Error("لا تملك صلاحية الدخول");
                }
            }
            return res.status(200).json({
                success: true,
                message: "تم تسجيل الدخول بنجاح",
                data: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    assignedSites: user.assignedSites ? String(user.assignedSites).split(',').map((s) => s.trim()).filter(Boolean) : [],
                    faceDescriptor: user.faceDescriptor,
                    biometricType: user.biometricType || (user.faceDescriptor ? 'face' : null),
                    biometricData: user.biometricData || user.faceDescriptor,
                    transportPrice: user.transportPrice,
                    salary: user.salary || 0
                }
            });
        }

        // --- NEW HELPER: RESOLVE TRANSPORT PRICE ---
        async function fetchResolvedTransportPrice(employeeId, siteId, currentPrice, isRequest) {
            const empIdStr = String(employeeId);
            const siteIdStr = String(siteId);

            // 1. Check Site Allowances table
            const { data: allowance, error: allowanceError } = await supabase
                .from('siteAllowances')
                .select('transportPrice')
                .eq('employeeId', empIdStr)
                .eq('siteId', siteIdStr)
                .maybeSingle(); // maybeSingle() is safer if row doesn't exist

            if (allowance) return allowance.transportPrice;

            // 2. If it's a request site, use the price passed or from the request
            if (isRequest) return currentPrice || 0;

            // 3. Check Employee Default
            const { data: emp, error: empError } = await supabase
                .from('employees')
                .select('transportPrice')
                .eq('id', empIdStr)
                .maybeSingle();

            if (emp && emp.transportPrice > 0) return emp.transportPrice;

            // 4. Default to Site Price
            return currentPrice || 0;
        }

        // --- PROCESS EMAIL APPROVAL (GET or POST) ---
        if (action === "processEmailApproval") {
            const token = data.token;
            if (!token) {
                return res.status(200).json({ success: false, message: "التوكن مفقود أو غير صالح" });
            }

            const decoded = verifySecureToken(token);
            if (!decoded) {
                return res.status(200).json({ success: false, message: "رابط الموافقة غير صالح أو منتهي الصلاحية (صلاحية الرابط 48 ساعة فقط)" });
            }

            const { requestId, action: decision, requestType, approverEmail } = decoded;
            const approvedByVal = approverEmail ? `البريد (${approverEmail})` : 'البريد الإلكتروني (HR)';

            // 1. Fetch current status of the request from database to verify "pending" state (Idempotency check)
            let currentStatus = '';
            let requestDetails = {};

            if (requestType === 'leave') {
                const { data: req, error } = await supabase.from('leaveRequests').select('*').eq('id', requestId).maybeSingle();
                if (error || !req) return res.status(200).json({ success: false, message: "لم يتم العثور على طلب الإجازة" });
                currentStatus = req.status;
                requestDetails = {
                    employeeId: req.employeeId,
                    employeeName: req.employeeName || 'غير معروف',
                    title: 'طلب إجازة',
                    details: `تاريخ الإجازة: ${req.leaveDate} - السبب: ${req.reason || 'لا يوجد'}`,
                    status: req.status
                };
            } else if (requestType === 'site') {
                const { data: req, error } = await supabase.from('siteRequests').select('*').eq('id', requestId).maybeSingle();
                if (error || !req) return res.status(200).json({ success: false, message: "لم يتم العثور على طلب تسجيل الموقع" });
                currentStatus = req.status;
                requestDetails = {
                    employeeId: req.employeeId,
                    employeeName: req.employeeName || 'غير معروف',
                    title: 'طلب تسجيل موقع جديد',
                    details: `اسم الموقع المقترح: ${req.suggestedName} - خط العرض: ${req.latitude} - خط الطول: ${req.longitude}`,
                    status: req.status
                };
            } else if (requestType === 'allowance') {
                const { data: req, error } = await supabase.from('allowanceRequests').select('*').eq('id', requestId).maybeSingle();
                if (error || !req) return res.status(200).json({ success: false, message: "لم يتم العثور على طلب زيادة البدلات" });
                currentStatus = req.status;
                requestDetails = {
                    employeeId: req.employeeId,
                    employeeName: req.employeeName || 'غير معروف',
                    title: 'طلب زيادة بدلات',
                    details: `مبلغ الزيادة المطلوبة: ${req.amount} ج.م`,
                    status: req.status
                };
            } else if (requestType === 'device') {
                const { data: req, error } = await supabase.from('device_change_requests').select('*').eq('id', requestId).maybeSingle();
                if (error || !req) return res.status(200).json({ success: false, message: "لم يتم العثور على طلب تغيير الجهاز" });
                currentStatus = req.status;
                requestDetails = {
                    employeeId: req.user_id,
                    employeeName: req.user_name || 'غير معروف',
                    title: 'طلب اعتماد جهاز جديد',
                    details: `الموديل: ${req.new_device_model || 'Unknown'} (${req.new_os_type || 'Unknown'})${req.reason ? ' - السبب: ' + req.reason : ''}`,
                    status: req.status
                };
            } else if (requestType === 'editSiteAllowances') {
                const { data: site } = await supabase.from('sites').select('*').eq('id', requestId).maybeSingle();
                if (!site) return res.status(200).json({ success: false, message: "لم يتم العثور على موقع العمل" });
                currentStatus = 'pending';
                if (req.method === 'GET') {
                    const { data: employees } = await supabase.from('employees').select('id, name');
                    const { data: allowances } = await supabase.from('siteAllowances').select('*').eq('siteId', requestId);
                    return res.status(200).json({
                        success: true,
                        isEditSiteAllowances: true,
                        requestDetails: {
                            title: `تعديل بدلات موقع ${site.name}`,
                            siteId: site.id,
                            siteName: site.name,
                            employees: employees || [],
                            siteAllowances: allowances || []
                        }
                    });
                }
            } else {
                return res.status(200).json({ success: false, message: "نوع الطلب غير معروف" });
            }

            // If it is a GET request, just return the preview details
            if (req.method === 'GET') {
                return res.status(200).json({
                    success: true,
                    alreadyProcessed: currentStatus !== 'pending',
                    decision: decision,
                    requestDetails: requestDetails
                });
            }

            // This is a POST request - execute the state mutation!
            if (currentStatus !== 'pending') {
                return res.status(200).json({
                    success: false,
                    alreadyProcessed: true,
                    message: "تم معالجة هذا الطلب مسبقاً! الحالة الحالية: " + (currentStatus === 'approved' ? 'مقبول' : currentStatus === 'rejected' ? 'مرفوض' : currentStatus)
                });
            }

            // Execute the corresponding approval/rejection logic!
            if (requestType === 'editSiteAllowances') {
                const { data: site } = await supabase.from('sites').select('*').eq('id', requestId).maybeSingle();
                if (!site) return res.status(200).json({ success: false, message: "لم يتم العثور على موقع العمل" });

                const updatedAllowances = data.siteAllowances || [];
                const { error: errDel } = await supabase.from('siteAllowances').delete().eq('siteId', requestId);
                if (errDel) throw errDel;

                if (updatedAllowances.length > 0) {
                    const allowanceRows = updatedAllowances.map(a => ({
                        employeeId: a.employeeId,
                        siteId: String(requestId),
                        transportPrice: parseFloat(a.transportPrice) || 0
                    }));
                    const { error: errIns } = await supabase.from('siteAllowances').insert(allowanceRows);
                    if (errIns) throw errIns;
                }

                syncToGoogleSheet({
                    action: 'updateSite',
                    id: requestId,
                    name: site.name,
                    latitude: site.latitude,
                    longitude: site.longitude,
                    radius: site.radius,
                    transportPrice: site.transportPrice,
                    mapLink: site.mapLink,
                    siteAllowances: updatedAllowances
                });

                invalidateCache('sites');
                invalidateCache('employees');

                return res.status(200).json({
                    success: true,
                    message: "تم تحديث بدلات الموقع بنجاح في قاعدة البيانات وشيت جوجل"
                });
            }

            if (requestType === 'leave') {
                if (decision === 'approved') {
                    // Update leave request
                    const { error } = await supabase.from('leaveRequests').update({
                        status: 'approved',
                        approvedAt: new Date().toISOString(),
                        approvedBy: approvedByVal
                    }).eq('id', requestId);
                    if (error) throw error;

                    // Notify employee
                    await supabase.from('notifications').insert([{
                        id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                        userId: requestDetails.employeeId,
                        title: 'تمت الموافقة على إجازتك',
                        message: `تمت الموافقة على طلب إجازتك عبر البريد` + (approverEmail ? ` (${approverEmail})` : ' الإلكتروني'),
                        type: 'leave_approved',
                        relatedId: requestId,
                        isRead: false,
                        createdAt: new Date().toISOString()
                    }]);
                } else {
                    // Reject leave request
                    const { error } = await supabase.from('leaveRequests').update({
                        status: 'rejected',
                        rejectionReason: approverEmail ? `تم الرفض عبر البريد (${approverEmail})` : 'تم الرفض عبر البريد الإلكتروني'
                    }).eq('id', requestId);
                    if (error) throw error;

                    // Notify employee
                    await supabase.from('notifications').insert([{
                        id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                        userId: requestDetails.employeeId,
                        title: 'تم رفض طلب إجازتك',
                        message: `تم رفض طلب إجازتك عبر البريد` + (approverEmail ? ` (${approverEmail})` : ' الإلكتروني'),
                        type: 'leave_rejected',
                        relatedId: requestId,
                        isRead: false,
                        createdAt: new Date().toISOString()
                    }]);
                }
            } else if (requestType === 'site') {
                // Fetch full request details first for site creation
                const { data: reqData } = await supabase.from('siteRequests').select('*').eq('id', requestId).single();
                if (!reqData) throw new Error("بيانات الطلب مفقودة");

                if (decision === 'approved') {
                    const finalStatus = 'approved';
                    const { error: errReq } = await supabase.from('siteRequests')
                        .update({
                            status: finalStatus,
                            approvedAt: new Date().toISOString(),
                            transportPrice: reqData.transportPrice,
                            tempRadius: reqData.tempRadius,
                            autoMeta: approvedByVal
                        })
                        .eq('id', requestId);
                    if (errReq) throw errReq;

                    // Insert site
                    const sitePayload = {
                        id: String(Math.floor(10000 + Math.random() * 90000)),
                        name: reqData.suggestedName,
                        latitude: reqData.latitude,
                        longitude: reqData.longitude,
                        radius: reqData.tempRadius || 100,
                        transportPrice: (reqData.transportPrice !== undefined && reqData.transportPrice !== null) ? reqData.transportPrice : 0,
                        mapLink: reqData.mapLink,
                        isTemporary: false
                    };
                    const { error: errSite } = await supabase.from('sites').insert([sitePayload]);
                    if (errSite) throw errSite;

                    // Notify employee
                    await supabase.from('notifications').insert([{
                        id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                        userId: reqData.employeeId,
                        title: 'تمت الموافقة على موقعك',
                        message: `تمت الموافقة على طلب تسجيل الموقع: ${reqData.suggestedName} بشكل دائم عبر البريد` + (approverEmail ? ` (${approverEmail})` : ' الإلكتروني'),
                        type: 'site_approved',
                        relatedId: requestId,
                        isRead: false,
                        createdAt: new Date().toISOString()
                    }]);
                } else {
                    const { error } = await supabase.from('siteRequests')
                        .update({
                            status: 'rejected',
                            autoMeta: approverEmail ? `تم الرفض عبر البريد (${approverEmail})` : 'تم الرفض عبر البريد الإلكتروني'
                        })
                        .eq('id', requestId);
                    if (error) throw error;

                    // Notify employee
                    await supabase.from('notifications').insert([{
                        id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                        userId: reqData.employeeId,
                        title: 'تم رفض طلب موقعك',
                        message: `تم رفض طلب تسجيل الموقع: ${reqData.suggestedName} عبر البريد` + (approverEmail ? ` (${approverEmail})` : ' الإلكتروني'),
                        type: 'site_rejected',
                        relatedId: requestId,
                        isRead: false,
                        createdAt: new Date().toISOString()
                    }]);
                }
            } else if (requestType === 'allowance') {
                // Fetch request data
                const { data: reqData } = await supabase.from('allowanceRequests').select('*').eq('id', requestId).single();
                if (!reqData) throw new Error("بيانات الطلب مفقودة");

                if (decision === 'approved') {
                    // Fetch current attendance record
                    const { data: attData, error: errAtt } = await supabase
                        .from('attendance')
                        .select('transportPrice')
                        .eq('id', reqData.attendanceId)
                        .single();

                    if (errAtt || !attData) throw new Error("سجل الحضور المرتبط بالطلب غير موجود");

                    const newPrice = parseFloat(attData.transportPrice || 0) + parseFloat(reqData.amount);

                    // Update attendance
                    const { error: errUpdAtt } = await supabase
                        .from('attendance')
                        .update({ transportPrice: newPrice })
                        .eq('id', reqData.attendanceId);

                    if (errUpdAtt) throw errUpdAtt;
                }

                // Update request status
                const { error: errUpdReq } = await supabase
                    .from('allowanceRequests')
                    .update({
                        status: decision,
                        approvedBy: approvedByVal,
                        rejectionReason: decision === 'rejected' ? (approverEmail ? `تم الرفض عبر البريد (${approverEmail})` : 'تم الرفض عبر البريد الإلكتروني') : '',
                        adminNote: approverEmail ? `تمت المعالجة عبر البريد (${approverEmail})` : 'تمت المعالجة عبر البريد الإلكتروني'
                    })
                    .eq('id', requestId);

                if (errUpdReq) throw errUpdReq;

                // Add Log
                const logId = "LOG" + Math.floor(10000 + Math.random() * 90000);
                await supabase.from('approvalLogs').insert([{
                    id: logId,
                    requestId: requestId,
                    adminId: 'email',
                    adminName: approverEmail ? `البريد (${approverEmail})` : 'Outlook Email',
                    action: decision,
                    details: decision === 'approved'
                        ? (approverEmail ? `تمت الموافقة على الطلب عبر البريد (${approverEmail})` : 'تمت الموافقة على الطلب عبر البريد الإلكتروني')
                        : (approverEmail ? `تم رفض الطلب عبر البريد (${approverEmail})` : 'تم رفض الطلب عبر البريد الإلكتروني'),
                    timestamp: new Date().toISOString()
                }]);

                // Notify employee
                const notifTitle = decision === 'approved' ? 'تمت الموافقة على طلب زيادة البدلات' : 'تم رفض طلب زيادة البدلات';
                const notifMessage = decision === 'approved'
                    ? `تمت الموافقة على طلب زيادة البدلات بمبلغ ${reqData.amount} ج.م عبر البريد` + (approverEmail ? ` (${approverEmail})` : ' الإلكتروني')
                    : `تم رفض طلب زيادة البدلات بمبلغ ${reqData.amount} ج.م عبر البريد` + (approverEmail ? ` (${approverEmail})` : ' الإلكتروني');

                await supabase.from('notifications').insert([{
                    id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                    userId: reqData.employeeId,
                    title: notifTitle,
                    message: notifMessage,
                    type: decision === 'approved' ? 'allowance_approved' : 'allowance_rejected',
                    relatedId: requestId,
                    isRead: false,
                    createdAt: new Date().toISOString()
                }]);
            } else if (requestType === 'device') {
                const { data: request } = await supabase.from('device_change_requests').select('*').eq('id', requestId).single();
                if (!request) throw new Error("بيانات الطلب مفقودة");

                if (decision === 'approved') {
                    // Deactivate old device
                    if (request.old_device_id) {
                        await supabase
                            .from('devices')
                            .update({ is_active: false, updated_at: new Date().toISOString() })
                            .eq('user_id', request.user_id)
                            .eq('device_id', request.old_device_id);
                    }

                    // Deactivate any other active devices for this user
                    await supabase
                        .from('devices')
                        .update({ is_active: false, updated_at: new Date().toISOString() })
                        .eq('user_id', request.user_id)
                        .eq('is_active', true);

                    // Upsert new device
                    const { error: upsertError } = await supabase
                        .from('devices')
                        .upsert({
                            user_id: request.user_id,
                            device_id: request.new_device_id,
                            device_model: request.new_device_model || 'Unknown',
                            os_type: request.new_os_type || 'Unknown',
                            browser_info: request.new_browser_info || 'Unknown',
                            is_active: true,
                            updated_at: new Date().toISOString()
                        }, {
                            onConflict: 'user_id,device_id'
                        });

                    if (upsertError) throw upsertError;

                    // Update request status
                    const { error: updateError } = await supabase
                        .from('device_change_requests')
                        .update({
                            status: 'approved',
                            processed_at: new Date().toISOString(),
                            processed_by: approvedByVal
                        })
                        .eq('id', requestId);

                    if (updateError) throw updateError;
                } else {
                    const { error } = await supabase
                        .from('device_change_requests')
                        .update({
                            status: 'rejected',
                            admin_note: approverEmail ? `تم الرفض عبر البريد (${approverEmail})` : 'تم الرفض عبر البريد الإلكتروني',
                            processed_at: new Date().toISOString(),
                            processed_by: approvedByVal
                        })
                        .eq('id', requestId);

                    if (error) throw error;
                }
            }

            // Dual write trigger for sync (keeps sheets backup 100% correct)
            const syncPayload = {
                action: requestType === 'leave'
                    ? (decision === 'approved' ? 'approveLeaveRequest' : 'rejectLeaveRequest')
                    : requestType === 'site'
                        ? (decision === 'approved' ? 'approveSiteRequest' : 'rejectSiteRequest')
                        : requestType === 'allowance'
                            ? 'handleAllowanceRequest'
                            : (decision === 'approved' ? 'approveDeviceChangeRequest' : 'rejectDeviceChangeRequest'),
                id: requestId,
                requestId: requestId,
                status: decision,
                approvedBy: approverEmail ? `البريد (${approverEmail})` : 'Outlook Email',
                rejectionReason: approverEmail ? `تم الرفض عبر البريد (${approverEmail})` : 'تم الرفض عبر البريد الإلكتروني',
                adminId: 'email',
                adminName: approverEmail ? `البريد (${approverEmail})` : 'Outlook Email',
                adminNote: approverEmail ? `تمت المعالجة عبر البريد (${approverEmail})` : 'تمت المعالجة عبر البريد الإلكتروني'
            };
            syncToGoogleSheet(syncPayload);

            return res.status(200).json({
                success: true,
                message: decision === 'approved' ? "تمت الموافقة وتحديث البيانات بنجاح" : "تم رفض الطلب بنجاح"
            });
        }

        // --- DASHBOARD DATA (GET) ---
        if (action === "getDashboardData") {
            const [employees, sites, attendance, siteRequests, settingsRows, siteAllowances, leaveRequests, allowanceRequests] = await Promise.all([
                fetchAllRows('employees'),
                fetchAllRows('sites'),
                fetchAllRows('attendance'),
                fetchAllRows('siteRequests'),
                fetchAllRows('settings'),
                fetchAllRows('siteAllowances'),
                fetchAllRows('leaveRequests'),
                fetchAllRows('allowanceRequests')
            ]);
            let settings = {};
            if (settingsRows) {
                settingsRows.forEach(s => settings[s.key] = s.value);
            }

            // Map allowances to employees
            const mappedEmployees = (employees || []).map(emp => ({
                ...emp,
                assignedSites: emp.assignedSites ? String(emp.assignedSites).split(',').map(s => s.trim()).filter(Boolean) : [],
                siteAllowances: (siteAllowances || []).filter(a => String(a.employeeId) === String(emp.id))
            }));

            // --- HOTFIX: Correct today's attendance status if it's a holiday ---
            let finalAttendance = attendance || [];
            try {
                const todayStr = getCairoDateString(new Date());
                const { data: holidayToday } = await supabase.from('official_holidays').select('*').eq('holidayDate', todayStr).maybeSingle();
                if (holidayToday) {
                    // Today is a holiday! Update any 'present' or 'late' records for today to 'overtime'
                    await supabase.from('attendance')
                        .update({ status: 'overtime' })
                        .in('status', ['present', 'late'])
                        .filter('checkIn', 'gte', todayStr + 'T00:00:00');

                    // Refresh attendance data for the response
                    finalAttendance = await fetchAllRows('attendance');
                }
            } catch (hotfixErr) {
                console.error("Hotfix failed:", hotfixErr);
            }

            return res.status(200).json({
                success: true,
                employees: mappedEmployees,
                sites: sites || [],
                attendance: finalAttendance,
                siteRequests: siteRequests || [],
                settings: settings,
                siteAllowances: siteAllowances || [],
                leaveRequests: leaveRequests || [],
                allowanceRequests: allowanceRequests || []
            });
        }

        if (action === "sendEmailDashboard") {
            const settings = await getNotificationSettings(supabase);
            if (!settings.enabled || settings.emails.length === 0) {
                return res.status(200).json({ success: false, message: "إشعارات البريد الإلكتروني معطلة أو لم يتم إعداد بريد إلكتروني للمستقبلين." });
            }

            // 1. Fetch data in parallel with pagination
            const [empRes, sites, attendance, leaveRequests, allowanceRequests, siteRequests, deviceReqRes, allAllowances] = await Promise.all([
                fetchAllRows('employees', 'id, name, role'),
                fetchAllRows('sites'),
                fetchAllRows('attendance'),
                fetchAllRows('leaveRequests'),
                fetchAllRows('allowanceRequests'),
                fetchAllRows('siteRequests'),
                fetchAllRows('device_change_requests'),
                fetchAllRows('siteAllowances')
            ]);

            const today = getCairoDateString(new Date());
            const todayAtt = (attendance || []).filter(r => r.checkIn && r.checkIn.startsWith(today));
            
            // Filter out admin and hr from active employee list
            const activeEmployees = (empRes || []).filter(e => e.role !== 'admin' && e.role !== 'hr');
            const presentIds = new Set(todayAtt.map(r => String(r.employeeId)));
            const presentCount = presentIds.size;
            
            const todayApprovedLeaves = (leaveRequests || []).filter(r => r.status === 'approved' && r.leaveDate === today);
            const leaveEmpIds = new Set(todayApprovedLeaves.map(l => String(l.employeeId)));
            
            // Absent means: not present AND not on approved leave today
            const absentEmployeesList = activeEmployees.filter(e => !presentIds.has(String(e.id)) && !leaveEmpIds.has(String(e.id)));

            const absentCount = absentEmployeesList.length;

            const pendingLeaves = (leaveRes.data || []).filter(r => r.status === 'pending');
            const pendingAllowances = allowRes.data || [];
            const pendingSites = siteReqRes.data || [];
            const pendingDevices = deviceReqRes.data || [];

            const hostHeader = req.headers.host || 'localhost:3000';
            const protocol = hostHeader.includes('localhost') || hostHeader.includes('127.0.0.1') ? 'http' : 'https';
            const baseUrl = `${protocol}://${hostHeader}`;

            // 2. Generate secure tokens for actions with 24-hour expiration
            const expiryMs = 24 * 60 * 60 * 1000; // 24 hours

            const formatCairoTimeHelper = (isoString) => {
                if (!isoString) return '-';
                const match = isoString.match(/T(\d{2}):(\d{2}):(\d{2})/);
                if (!match) return isoString;
                let hours = parseInt(match[1], 10);
                const minutes = match[2];
                const period = hours >= 12 ? 'م' : 'ص';
                if (hours > 12) hours -= 12;
                if (hours === 0) hours = 12;
                return `${hours}:${minutes} ${period}`;
            };

            // Build Today's Present Employees HTML (replacing Sites HTML)
            let presentHtml = '';
            const presentEmployeesList = activeEmployees.filter(e => presentIds.has(String(e.id)));
            if (presentEmployeesList.length === 0) {
                presentHtml = `
                    <div style="text-align: center; color: #64748b; padding: 15px; font-size: 14px; border: 1px dashed #cbd5e1; border-radius: 8px; background: #ffffff; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                        لا يوجد حضور مسجل اليوم حتى الآن.
                    </div>
                `;
            } else {
                presentHtml = `
                    <div style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #ffffff;">
                        <table width="100%" cellpadding="12" cellspacing="0" border="0" style="direction: rtl; border-collapse: collapse; min-width: 100%;">
                            <thead>
                                <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                    <th align="right" style="font-size: 13px; color: #475569; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">الموظف</th>
                                    <th align="right" style="font-size: 13px; color: #475569; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">الموقع</th>
                                    <th align="center" style="font-size: 13px; color: #475569; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">الحضور</th>
                                    <th align="center" style="font-size: 13px; color: #475569; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">الانصراف</th>
                                    <th align="center" style="font-size: 13px; color: #475569; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">الحالة</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                
                presentEmployeesList.forEach((emp) => {
                    const empAtts = todayAtt.filter(r => String(r.employeeId) === String(emp.id));
                    empAtts.forEach((att) => {
                        const checkInTime = formatCairoTimeHelper(att.checkIn);
                        const checkOutTime = att.checkOut ? formatCairoTimeHelper(att.checkOut) : (att.status === 'no_checkout' ? 'لم ينصرف' : 'حاضر الآن');
                        
                        let statusText = 'حاضر';
                        let statusColor = '#10b981';
                        let statusBg = 'rgba(16, 185, 129, 0.1)';
                        if (att.status === 'late') {
                            statusText = 'متأخر';
                            statusColor = '#ef4444';
                            statusBg = 'rgba(239, 68, 68, 0.1)';
                        } else if (att.status === 'overtime') {
                            statusText = 'عمل إضافي';
                            statusColor = '#3b82f6';
                            statusBg = 'rgba(59, 130, 246, 0.1)';
                        } else if (att.status === 'no_checkout') {
                            statusText = 'لم ينصرف';
                            statusColor = '#f59e0b';
                            statusBg = 'rgba(245, 158, 11, 0.1)';
                        }
                        
                        presentHtml += `
                                <tr style="border-bottom: 1px solid #f1f5f9;">
                                    <td align="right" style="font-size: 13px; color: #0f172a; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">${emp.name}</td>
                                    <td align="right" style="font-size: 13px; color: #475569; font-family: 'Cairo', 'Segoe UI', sans-serif;">${att.siteName || '-'}</td>
                                    <td align="center" style="font-size: 13px; color: #475569; font-family: 'Cairo', 'Segoe UI', sans-serif;" dir="ltr">${checkInTime}</td>
                                    <td align="center" style="font-size: 13px; color: #475569; font-family: 'Cairo', 'Segoe UI', sans-serif;" dir="ltr">${checkOutTime}</td>
                                    <td align="center" style="font-size: 12px; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                                        <span style="color: ${statusColor}; background: ${statusBg}; padding: 4px 8px; border-radius: 6px; font-weight: bold; display: inline-block;">${statusText}</span>
                                    </td>
                                </tr>
                        `;
                    });
                });
                
                presentHtml += `
                            </tbody>
                        </table>
                    </div>
                `;
            }

            // Build Today's Absent Employees HTML
            let absentHtml = '';
            const allAbsentList = activeEmployees.filter(e => !presentIds.has(String(e.id)));
            if (allAbsentList.length === 0) {
                absentHtml = `
                    <div style="text-align: center; color: #10b981; padding: 15px; font-size: 14px; border: 1px dashed #a7f3d0; border-radius: 8px; background: #ecfdf5; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                        لا يوجد غياب اليوم، جميع الموظفين حاضرين!
                    </div>
                `;
            } else {
                absentHtml = `
                    <div style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #ffffff;">
                        <table width="100%" cellpadding="12" cellspacing="0" border="0" style="direction: rtl; border-collapse: collapse; min-width: 100%;">
                            <thead>
                                <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                    <th align="right" style="font-size: 13px; color: #475569; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">الموظف</th>
                                    <th align="center" style="font-size: 13px; color: #475569; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">الحالة</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                
                allAbsentList.forEach(emp => {
                    const isOnLeave = leaveEmpIds.has(String(emp.id));
                    const statusText = isOnLeave ? 'إجازة معتمدة' : 'غائب';
                    const statusColor = isOnLeave ? '#3b82f6' : '#ef4444';
                    const statusBg = isOnLeave ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)';
                    
                    absentHtml += `
                                <tr style="border-bottom: 1px solid #f1f5f9;">
                                    <td align="right" style="font-size: 13px; color: #0f172a; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">${emp.name}</td>
                                    <td align="center" style="font-size: 12px; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                                        <span style="color: ${statusColor}; background: ${statusBg}; padding: 4px 8px; border-radius: 6px; font-weight: bold; display: inline-block;">${statusText}</span>
                                    </td>
                                </tr>
                    `;
                });
                
                absentHtml += `
                            </tbody>
                        </table>
                    </div>
                `;
            }

            // Build Pending Requests HTML (No garbled emojis)
            let requestsHtml = '';

            // 2.1 Leaves
            pendingLeaves.forEach(req => {
                const approveToken = generateSecureToken(req.id, 'approved', 'leave', settings.emails[0], expiryMs);
                const rejectToken = generateSecureToken(req.id, 'rejected', 'leave', settings.emails[0], expiryMs);
                const approveLink = `${baseUrl}/confirm-action.html?token=${approveToken}`;
                const rejectLink = `${baseUrl}/confirm-action.html?token=${rejectToken}`;
                requestsHtml += `
                    <div style="border-right: 4px solid #f59e0b; background: #fffbeb; padding: 15px; border-radius: 8px; margin-bottom: 12px; border-top: 1px solid #fef3c7; border-left: 1px solid #fef3c7; border-bottom: 1px solid #fef3c7; direction: rtl; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                        <div style="font-weight: bold; color: #b45309; font-size: 14px;">طلب إجازة - الموظف: ${req.employeeName}</div>
                        <div style="font-size: 13px; color: #451a03; margin-top: 4px;">تاريخ: ${req.leaveDate} - السبب: ${req.reason || 'لا يوجد'}</div>
                        <div style="margin-top: 10px;">
                            <a href="${approveLink}" target="_blank" style="background: #10b981; color: white; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: bold; text-decoration: none; display: inline-block; box-shadow: 0 2px 4px rgba(16,185,129,0.2); font-family: 'Cairo', 'Segoe UI', sans-serif;">موافقة</a>
                            <a href="${rejectLink}" target="_blank" style="background: #ef4444; color: white; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: bold; text-decoration: none; display: inline-block; box-shadow: 0 2px 4px rgba(239,68,68,0.2); margin-right: 8px; font-family: 'Cairo', 'Segoe UI', sans-serif;">رفض</a>
                        </div>
                    </div>
                `;
            });

            // 2.2 Allowances
            pendingAllowances.forEach(req => {
                const approveToken = generateSecureToken(req.id, 'approved', 'allowance', settings.emails[0], expiryMs);
                const rejectToken = generateSecureToken(req.id, 'rejected', 'allowance', settings.emails[0], expiryMs);
                const approveLink = `${baseUrl}/confirm-action.html?token=${approveToken}`;
                const rejectLink = `${baseUrl}/confirm-action.html?token=${rejectToken}`;
                requestsHtml += `
                    <div style="border-right: 4px solid #f59e0b; background: #fffbeb; padding: 15px; border-radius: 8px; margin-bottom: 12px; border-top: 1px solid #fef3c7; border-left: 1px solid #fef3c7; border-bottom: 1px solid #fef3c7; direction: rtl; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                        <div style="font-weight: bold; color: #b45309; font-size: 14px;">طلب زيادة بدلات - الموظف: ${req.employeeName}</div>
                        <div style="font-size: 13px; color: #451a03; margin-top: 4px;">القيمة: ${req.amount} ج.م - السبب: ${req.reason || 'لا يوجد'}</div>
                        <div style="margin-top: 10px;">
                            <a href="${approveLink}" target="_blank" style="background: #10b981; color: white; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: bold; text-decoration: none; display: inline-block; box-shadow: 0 2px 4px rgba(16,185,129,0.2); font-family: 'Cairo', 'Segoe UI', sans-serif;">موافقة</a>
                            <a href="${rejectLink}" target="_blank" style="background: #ef4444; color: white; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: bold; text-decoration: none; display: inline-block; box-shadow: 0 2px 4px rgba(239,68,68,0.2); margin-right: 8px; font-family: 'Cairo', 'Segoe UI', sans-serif;">رفض</a>
                        </div>
                    </div>
                `;
            });

            // 2.3 Sites requests
            pendingSites.forEach(req => {
                const approveToken = generateSecureToken(req.id, 'approved', 'site', settings.emails[0], expiryMs);
                const rejectToken = generateSecureToken(req.id, 'rejected', 'site', settings.emails[0], expiryMs);
                const approveLink = `${baseUrl}/confirm-action.html?token=${approveToken}`;
                const rejectLink = `${baseUrl}/confirm-action.html?token=${rejectToken}`;
                requestsHtml += `
                    <div style="border-right: 4px solid #f59e0b; background: #fffbeb; padding: 15px; border-radius: 8px; margin-bottom: 12px; border-top: 1px solid #fef3c7; border-left: 1px solid #fef3c7; border-bottom: 1px solid #fef3c7; direction: rtl; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                        <div style="font-weight: bold; color: #b45309; font-size: 14px;">طلب تسجيل موقع جديد - الموظف: ${req.employeeName}</div>
                        <div style="font-size: 13px; color: #451a03; margin-top: 4px;">الاسم المقترح: ${req.suggestedName} - الإحداثيات: (${req.latitude}, ${req.longitude})</div>
                        <div style="margin-top: 10px;">
                            <a href="${approveLink}" target="_blank" style="background: #10b981; color: white; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: bold; text-decoration: none; display: inline-block; box-shadow: 0 2px 4px rgba(16,185,129,0.2); font-family: 'Cairo', 'Segoe UI', sans-serif;">موافقة</a>
                            <a href="${rejectLink}" target="_blank" style="background: #ef4444; color: white; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: bold; text-decoration: none; display: inline-block; box-shadow: 0 2px 4px rgba(239,68,68,0.2); margin-right: 8px; font-family: 'Cairo', 'Segoe UI', sans-serif;">رفض</a>
                        </div>
                    </div>
                `;
            });

            // 2.4 Device requests
            pendingDevices.forEach(req => {
                const approveToken = generateSecureToken(req.id, 'approved', 'device', settings.emails[0], expiryMs);
                const rejectToken = generateSecureToken(req.id, 'rejected', 'device', settings.emails[0], expiryMs);
                const approveLink = `${baseUrl}/confirm-action.html?token=${approveToken}`;
                const rejectLink = `${baseUrl}/confirm-action.html?token=${rejectToken}`;
                requestsHtml += `
                    <div style="border-right: 4px solid #f59e0b; background: #fffbeb; padding: 15px; border-radius: 8px; margin-bottom: 12px; border-top: 1px solid #fef3c7; border-left: 1px solid #fef3c7; border-bottom: 1px solid #fef3c7; direction: rtl; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                        <div style="font-weight: bold; color: #b45309; font-size: 14px;">طلب تغيير جهاز - الموظف: ${req.user_name}</div>
                        <div style="font-size: 13px; color: #451a03; margin-top: 4px;">جهاز جديد: ${req.new_device_model || 'Unknown'} (${req.new_os_type || 'Unknown'})${req.reason ? ' - السبب: ' + req.reason : ''}</div>
                        <div style="margin-top: 10px;">
                            <a href="${approveLink}" target="_blank" style="background: #10b981; color: white; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: bold; text-decoration: none; display: inline-block; box-shadow: 0 2px 4px rgba(16,185,129,0.2); font-family: 'Cairo', 'Segoe UI', sans-serif;">موافقة</a>
                            <a href="${rejectLink}" target="_blank" style="background: #ef4444; color: white; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: bold; text-decoration: none; display: inline-block; box-shadow: 0 2px 4px rgba(239,68,68,0.2); margin-right: 8px; font-family: 'Cairo', 'Segoe UI', sans-serif;">رفض</a>
                        </div>
                    </div>
                `;
            });

            if (requestsHtml === '') {
                requestsHtml = `
                    <div style="text-align: center; color: #64748b; padding: 20px; font-size: 14px; border: 1px dashed #e2e8f0; border-radius: 8px; background: #f8fafc; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                        لا توجد طلبات معلقة بانتظار المراجعة حالياً.
                    </div>
                `;
            }

            const totalPendingCount = pendingLeaves.length + pendingAllowances.length + pendingSites.length + pendingDevices.length;

            // 3. Compose Email HTML Template
            const emailHtml = `
            <!DOCTYPE html>
            <html lang="ar">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
                <title>ملخص نظام الموارد البشرية</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
                </style>
            </head>
            <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl;">
                <div dir="rtl" style="max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                    <!-- Premium Header -->
                    <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 30px 20px; text-align: center;">
                        <h2 style="margin: 0; color: #a3e635; font-size: 24px; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">لوحة تحكم البريد الإلكتروني الذكية</h2>
                        <p style="margin: 5px 0 0 0; color: #94a3b8; font-size: 14px; font-family: 'Cairo', 'Segoe UI', sans-serif;">نظام الموارد البشرية الموحد | ملخص الحضور والطلبات</p>
                        <div style="margin-top: 15px; display: inline-block; background: rgba(255,255,255,0.07); padding: 6px 16px; border-radius: 20px; color: #f8fafc; font-size: 13px; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                            تاريخ التقرير: ${today}
                        </div>
                    </div>

                    <!-- Statistics Cards Grid -->
                    <div style="padding: 20px 20px 10px 20px;">
                        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="direction: rtl;">
                            <tr>
                                <td width="31%" style="padding: 5px;">
                                    <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 12px; text-align: center; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                                        <div style="font-size: 12px; color: #065f46; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                                            <span style="color: #10b981; font-size: 14px; margin-left: 4px;">●</span>الحاضرون
                                        </div>
                                        <div style="font-size: 22px; color: #10b981; font-weight: 800; margin-top: 4px; font-family: 'Cairo', 'Segoe UI', sans-serif;">${presentCount}</div>
                                    </div>
                                </td>
                                <td width="31%" style="padding: 5px;">
                                    <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; padding: 12px; text-align: center; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                                        <div style="font-size: 12px; color: #991b1b; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                                            <span style="color: #ef4444; font-size: 14px; margin-left: 4px;">●</span>المتغيبون
                                        </div>
                                        <div style="font-size: 22px; color: #ef4444; font-weight: 800; margin-top: 4px; font-family: 'Cairo', 'Segoe UI', sans-serif;">${absentCount}</div>
                                    </div>
                                </td>
                                <td width="38%" style="padding: 5px;">
                                    <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 12px; padding: 12px; text-align: center; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                                        <div style="font-size: 12px; color: #92400e; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                                            <span style="color: #f59e0b; font-size: 14px; margin-left: 4px;">●</span>طلبات معلقة
                                        </div>
                                        <div style="font-size: 22px; color: #f59e0b; font-weight: 800; margin-top: 4px; font-family: 'Cairo', 'Segoe UI', sans-serif;">${totalPendingCount}</div>
                                    </div>
                                </td>
                            </tr>
                        </table>
                    </div>

                    <!-- Main Sections Wrapper -->
                    <div style="padding: 10px 20px 25px 20px;">
                        
                        <!-- 1. PENDING REQUESTS -->
                        <div style="margin-top: 15px;">
                            <h3 style="border-bottom: 2px solid #f59e0b; padding-bottom: 6px; color: #0f172a; font-size: 16px; font-weight: bold; margin-bottom: 15px; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                                <span style="color: #f59e0b; font-size: 16px; margin-left: 4px;">●</span>الالطلبات المعلقة والإجراءات السريعة
                            </h3>
                            ${requestsHtml}
                        </div>

                        <!-- 2. TODAY'S PRESENT -->
                        <div style="margin-top: 30px;">
                            <h3 style="border-bottom: 2px solid #10b981; padding-bottom: 6px; color: #0f172a; font-size: 16px; font-weight: bold; margin-bottom: 15px; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                                <span style="color: #10b981; font-size: 16px; margin-left: 4px;">●</span>تفاصيل حضور اليوم
                            </h3>
                            ${presentHtml}
                        </div>

                        <!-- 3. TODAY'S ABSENT -->
                        <div style="margin-top: 30px;">
                            <h3 style="border-bottom: 2px solid #ef4444; padding-bottom: 6px; color: #0f172a; font-size: 16px; font-weight: bold; margin-bottom: 15px; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                                <span style="color: #ef4444; font-size: 16px; margin-left: 4px;">●</span>تفاصيل غياب اليوم
                            </h3>
                            ${absentHtml}
                        </div>

                        <!-- 4. ACTIONS AND DIRECT LINKS -->
                        <div style="margin-top: 30px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; text-align: center; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                            <h4 style="margin: 0 0 10px 0; color: #0f172a; font-size: 14px; font-weight: bold; font-family: 'Cairo', 'Segoe UI', sans-serif;">هل تود رؤية لوحة التحكم الكاملة والتقارير الحية؟</h4>
                            <a href="${baseUrl}/hr/index.html" target="_blank" style="background: #10b981; color: white; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: bold; text-decoration: none; display: inline-block; box-shadow: 0 4px 12px rgba(16,185,129,0.3); border: 1px solid #059669; font-family: 'Cairo', 'Segoe UI', sans-serif;">الدخول للوحة التحكم الحية</a>
                            <div style="margin-top: 10px; font-size: 11px; color: #64748b; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                                تنبيه أمني: تنتهي صلاحية الروابط الفرعية لتعديل البدلات تلقائياً بعد مرور 24 ساعة من تاريخ الإرسال.
                            </div>
                        </div>

                    </div>

                    <!-- Footer -->
                    <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-radius: 0 0 16px 16px; font-family: 'Cairo', 'Segoe UI', sans-serif;">
                        نظام الموارد البشرية الذكي | تم توليد وإرسال هذا الملخص تلقائياً بناءً على طلبك.<br>
                        © 2026 جميع الحقوق محفوظة لشركتكم.
                    </div>
                </div>
            </body>
            </html>
            `;

            const textBody = `
لوحة تحكم البريد الإلكتروني الذكية لليوم ${today}
----------------------------------------
حضور اليوم: ${presentCount}
غياب اليوم: ${absentCount}
الطلبات المعلقة: ${totalPendingCount}

يرجى فتح البريد الإلكتروني في محرك يدعم قراءة رسائل HTML لتتمكن من مراجعة الإجراءات السريعة وتفاصيل الحضور والغياب.
            `.trim();

            const emailResult = await sendEmailNotification({
                to: settings.emails,
                subject: `تقرير ملخص الموارد البشرية - حضور وانصراف ${today}`,
                html: emailHtml,
                text: textBody
            });

            if (emailResult.success) {
                return res.status(200).json({ success: true, message: "تم إرسال لوحة التحكم المصغرة إلى بريدك الإلكتروني بنجاح" });
            } else {
                return res.status(200).json({ success: false, message: "فشل إرسال البريد الإلكتروني: " + emailResult.message });
            }
        }

        // --- EMPLOYEE DASHBOARD INIT ---
        if (action === "getPortalInitialData") {
            const empId = data.employeeId;
            const [siteRes, attRes, leaveRes, allowanceRes, siteReqRes, deviceReqRes] = await Promise.all([
                supabase.from('sites').select('*'),
                supabase.from('attendance').select('*').eq('employeeId', empId).order('checkIn', { ascending: true }),
                supabase.from('leaveRequests').select('*').eq('employeeId', empId).order('leaveDate', { ascending: false }),
                supabase.from('allowanceRequests').select('*').eq('employeeId', empId).order('createdAt', { ascending: false }),
                supabase.from('siteRequests').select('*').eq('employeeId', empId).order('timestamp', { ascending: false }),
                supabase.from('device_change_requests').select('*').eq('user_id', empId).order('created_at', { ascending: false })
            ]);
            return res.status(200).json({
                success: true,
                sites: siteRes.data || [],
                attendance: attRes.data || [],
                leaveRequests: leaveRes.data || [],
                allowanceRequests: allowanceRes.data || [],
                siteRequests: siteReqRes.data || [],
                deviceChangeRequests: deviceReqRes.data || []
            });
        }

        if (action === "getLeaveRequests") {
            let query = supabase.from('leaveRequests').select('*').order('leaveDate', { ascending: false });
            if (data.employeeId) query = query.eq('employeeId', data.employeeId);
            const { data: leaves, error } = await query;
            if (error) throw error;
            return res.status(200).json({ success: true, data: leaves });
        }

        if (action === "getAttendance") {
            let sbAtt;
            if (data.employeeId) {
                const { data: res, error } = await supabase.from('attendance').select('*').eq('employeeId', data.employeeId).order('checkIn', { ascending: true });
                if (error) throw error;
                sbAtt = res;
            } else {
                sbAtt = await fetchAllRows('attendance', '*', 'checkIn', true);
            }

            let mergedAttendance = sbAtt || [];

            // Detect if historical archive data is needed (if requested explicitly or start date is older than 365 days)
            const retentionCutoff = new Date();
            retentionCutoff.setDate(retentionCutoff.getDate() - 365);
            const hasOldDateRequested = data.startDate && new Date(data.startDate) < retentionCutoff;

            if (data.includeArchive === true || hasOldDateRequested) {
                try {
                    // Fetch full historical archive list from Google Sheets
                    const gsAttendance = await fetchGoogleSheetsAttendanceWithCache(
                        data.employeeId || '',
                        data.startDate || '',
                        data.endDate || ''
                    );

                    // Filter sheets rows by employee and date parameters if present
                    let filteredGs = gsAttendance;
                    if (data.employeeId) {
                        filteredGs = filteredGs.filter(r => String(r.employeeId) === String(data.employeeId));
                    }
                    if (data.startDate) {
                        filteredGs = filteredGs.filter(r => r.checkIn && r.checkIn.slice(0, 10) >= data.startDate);
                    }
                    if (data.endDate) {
                        filteredGs = filteredGs.filter(r => r.checkIn && r.checkIn.slice(0, 10) <= data.endDate);
                    }

                    // Merging and Deduplication by attendance ID or signature
                    const attMap = new Map();

                    // Add Google Sheets records first (historical)
                    filteredGs.forEach(record => {
                        const sig = record.id || `${record.employeeId}_${Date.parse(record.checkIn)}`;
                        attMap.set(sig, record);
                    });

                    // Add Supabase records (which takes priority / updates sheets records)
                    mergedAttendance.forEach(record => {
                        const sig = record.id || `${record.employeeId}_${Date.parse(record.checkIn)}`;
                        attMap.set(sig, record);
                    });

                    mergedAttendance = Array.from(attMap.values());

                    // Sort ascending by checkIn date
                    mergedAttendance.sort((a, b) => new Date(a.checkIn) - new Date(b.checkIn));
                } catch (gsError) {
                    console.error("Failed to merge archive records from Google Sheets:", gsError);
                    // Safe fallback: continue with Supabase-only data
                }
            }

            return res.status(200).json({ success: true, data: mergedAttendance });
        }

        // --- ADD ATTENDANCE (CHECK-IN) ---
        if (action === "addAttendance") {
            console.log("addAttendance called with data:", JSON.stringify(data));

            // 0. DEVICE VERIFICATION (Mandatory Layer)
            // Verify device before allowing attendance
            const deviceId = data.deviceId;
            const deviceInfo = data.deviceInfo || {};

            if (!deviceId) {
                return res.status(200).json({
                    success: false,
                    message: "مطلوب معرف الجهاز (Device ID) للتسجيل"
                });
            }

            const deviceCheck = await verifyDeviceForAttendance(
                supabase,
                data.employeeId,
                deviceId,
                deviceInfo
            );

            if (!deviceCheck.allowed) {
                return res.status(200).json({
                    success: false,
                    message: deviceCheck.message,
                    deviceRejected: true,
                    hasPendingRequest: deviceCheck.hasPendingRequest || false
                });
            }

            // Device is verified - include device_id in attendance record
            const attendanceDeviceId = deviceId;

            // 0.1 Double Check-In Prevention
            const { data: openAtt } = await supabase.from('attendance')
                .select('id, checkIn, status')
                .eq('employeeId', data.employeeId)
                .is('checkOut', null)
                .neq('status', 'no_checkout')
                .order('checkIn', { ascending: false })
                .limit(1);

            if (openAtt && openAtt.length > 0) {
                const openSession = openAtt[0];
                const openDate = new Date(openSession.checkIn).toDateString();
                const todayDate = new Date(data.checkIn).toDateString();

                if (openDate !== todayDate) {
                    // Session from a previous day — mark as 'no_checkout' but preserve 'overtime' status for weekend/holiday work
                    const eod = new Date(openSession.checkIn);
                    eod.setHours(23, 59, 59, 999);
                    // Preserve overtime status if it was a weekend/holiday work day, otherwise mark as no_checkout
                    const preservedStatus = openSession.status === 'overtime' ? 'overtime' : 'no_checkout';
                    await supabase.from('attendance')
                        .update({ checkOut: eod.toISOString(), totalHours: 0, status: preservedStatus })
                        .eq('id', openSession.id);
                } else {
                    // Same-day open session — block and return openSessionId for frontend
                    return res.status(200).json({
                        success: false,
                        openSession: true,
                        openSessionId: openSession.id,
                        message: "لديك عملية حضور مفتوحة بالفعل. يرجى تسجيل الانصراف أولاً."
                    });
                }
            }

            // 0.5 Duplicate Timestamp Prevention (Race Condition Protection)
            // Check if there's any record within ±60 seconds window to catch concurrent requests
            const clientCheckIn = new Date(data.checkIn);
            const sixtySecondsAgo = new Date(clientCheckIn.getTime() - 60000);
            const sixtySecondsAhead = new Date(clientCheckIn.getTime() + 60000);
            const { data: recentDups } = await supabase.from('attendance')
                .select('id, checkIn')
                .eq('employeeId', data.employeeId)
                .gte('checkIn', sixtySecondsAgo.toISOString())
                .lte('checkIn', sixtySecondsAhead.toISOString())
                .order('checkIn', { ascending: false })
                .limit(1);

            if (recentDups && recentDups.length > 0) {
                return res.status(200).json({
                    success: false,
                    duplicateEntry: true,
                    message: "تم تسجيل الحضور بالفعل في نفس اللحظة. لا يمكن تكرار العملية."
                });
            }

            // 0.6 Additional protection: Check if there's ANY record in the last 30 seconds
            // regardless of checkout status - prevents duplicate check-ins entirely
            // Use Cairo time (not UTC) to match the stored checkIn times
            const rateLimitNow = getCairoTime(new Date());
            const thirtySecondsAgo = new Date(rateLimitNow.getTime() - 30000);

            console.log('🚨 Rate Limit Debug:', {
                serverTime: new Date().toISOString(),
                cairoTime: rateLimitNow.toISOString(),
                thirtySecondsAgo: thirtySecondsAgo.toISOString(),
                employeeId: data.employeeId
            });

            const { data: anyRecentRecord } = await supabase.from('attendance')
                .select('id, checkIn, checkOut')
                .eq('employeeId', data.employeeId)
                .gte('checkIn', thirtySecondsAgo.toISOString())
                .order('checkIn', { ascending: false })
                .limit(1);

            console.log('🚨 Recent records found:', anyRecentRecord?.length || 0);

            if (anyRecentRecord && anyRecentRecord.length > 0) {
                const lastRecordTime = new Date(anyRecentRecord[0].checkIn);
                const secondsElapsed = Math.floor((rateLimitNow - lastRecordTime) / 1000);
                const secondsRemaining = 30 - secondsElapsed;

                console.log('🚨 Last record:', {
                    checkIn: anyRecentRecord[0].checkIn,
                    parsedTime: lastRecordTime.toISOString(),
                    secondsElapsed,
                    secondsRemaining
                });

                return res.status(200).json({
                    success: false,
                    duplicateEntry: true,
                    message: `تم تسجيل حضور منذ ${secondsElapsed} ثانية. يرجى الانتظار ${Math.max(0, secondsRemaining)} ثانية أخرى قبل إعادة المحاولة.`
                });
            }

            // 1. Biometric/PIN Check - BLOCK password-only authentication
            // Must have biometric data (face, fingerprint, or Face ID) - NO PIN/password fallback
            const userBioType = data.biometricType || (data.faceDescriptor ? 'face' : null);

            // REJECT if no biometric data provided (password/PIN not allowed)
            if (!data.biometricData && !data.faceDescriptor) {
                throw new Error("⚠️ مطلوب بصمة للتسجيل - لا يُسمح باستخدام PIN أو كلمة المرور للحضور");
            }

            // Verify employee has biometric registered
            const { data: empBioData } = await supabase.from('employees')
                .select('"biometricType", "biometricData", "faceDescriptor"')
                .eq('id', String(data.employeeId))
                .maybeSingle();

            if (!empBioData) {
                throw new Error("⚠️ لم يتم تسجيل بصمة لهذا الموظف - يرجى التواصل مع HR");
            }

            // Check if employee has ANY biometric registered (face, fingerprint, or Face ID)
            const hasBiometric = empBioData.biometricData || empBioData.faceDescriptor;
            if (!hasBiometric) {
                throw new Error("⚠️ لم يتم تسجيل بصمة لهذا الموظف - يرجى التواصل مع HR لتسجيل الوجه أو البصمة");
            }

            // 2. Check Location logic
            const { data: sites } = await supabase.from('sites').select('*');
            let matchedSite = null;
            let isRequest = false;

            if (sites && sites.length > 0) {
                // If client explicitly selected a siteId, check if client is within this site's radius
                if (data.siteId) {
                    const requestedSite = sites.find(s => String(s.id) === String(data.siteId));
                    if (requestedSite) {
                        const d = getDistance(data.latitude, data.longitude, requestedSite.latitude, requestedSite.longitude);
                        if (d <= requestedSite.radius) {
                            matchedSite = requestedSite;
                        }
                    }
                }

                // Fallback: If siteId was not provided or outside selected site's radius, pick first matching site
                if (!matchedSite) {
                    for (let s of sites) {
                        let d = getDistance(data.latitude, data.longitude, s.latitude, s.longitude);
                        if (d <= s.radius) { matchedSite = s; break; }
                    }
                }
            }

            if (!matchedSite) {
                // Check if any approved today or PENDING (> 2min) request matches
                const { data: reqs } = await supabase.from('siteRequests').select('*').eq('employeeId', data.employeeId);
                if (reqs) {
                    const now = new Date();
                    for (let r of reqs) {
                        let isAutoApprovable = false;
                        if (r.status === 'pending') {
                            const createdAt = new Date(r.timestamp || r.approvedAt);
                            if (now - createdAt >= 2 * 60 * 1000) isAutoApprovable = true;
                        }

                        if (r.status === 'approved_today' || isAutoApprovable) {
                            let d = getDistance(data.latitude, data.longitude, r.latitude, r.longitude);
                            let radius = isAutoApprovable ? 700 : (r.tempRadius || 100);
                            if (d <= radius) {
                                matchedSite = { id: r.id, name: r.suggestedName, transportPrice: r.transportPrice };
                                isRequest = true;

                                // Silent Auto-Approval update if pending
                                if (isAutoApprovable) {
                                    await supabase.from('siteRequests').update({
                                        status: 'approved_today',
                                        tempRadius: 700,
                                        approvedAt: getCairoISOString(now),
                                        note: (r.note ? r.note + " | " : "") + "[AUTO APPROVED after 2 minutes]"
                                    }).eq('id', r.id);
                                }
                                break;
                            }
                        }
                    }
                }
            }

            if (!matchedSite) throw new Error("أنت خارج نطاق جميع مواقع العمل المسجلة");

            // Calculate status using SERVER-SIDE Cairo time (authoritative source)
            const serverNow = new Date();
            const cairoNow = getCairoTime(serverNow);
            const dayOfWeek = cairoNow.getDay();
            let status = "present";

            // Get settings for work start time and weekend days
            const { data: setRows } = await supabase.from('settings').select('*').in('key', ['workStartTime', 'weekendDays']);
            let workStart = "09:00";
            let weekendDays = [5, 6]; // Default: Friday, Saturday

            if (setRows && setRows.length > 0) {
                const workStartRow = setRows.find(r => r.key === 'workStartTime');
                if (workStartRow) workStart = workStartRow.value;

                const weekendRow = setRows.find(r => r.key === 'weekendDays');
                if (weekendRow && weekendRow.value) {
                    weekendDays = weekendRow.value.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
                }
            }

            // Use server Cairo time for authoritative status calculation
            const checkInTimeStr = getCairoTimeString(serverNow);

            // Check if today is an official holiday
            const todayDateStr = getCairoDateString(serverNow);
            const { data: holidayData } = await supabase.from('official_holidays').select('*').eq('holidayDate', todayDateStr).maybeSingle();
            const isOfficialHoliday = holidayData !== null;

            // Check if employee already has any attendance today (not just open sessions)
            const todayStart = new Date(serverNow);
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date(serverNow);
            todayEnd.setHours(23, 59, 59, 999);
            const { data: todayAtt } = await supabase.from('attendance')
                .select('status')
                .eq('employeeId', data.employeeId)
                .gte('checkIn', todayStart.toISOString())
                .lte('checkIn', todayEnd.toISOString())
                .limit(1);
            const hasAttendedToday = todayAtt && todayAtt.length > 0;

            if (isOfficialHoliday || weekendDays.includes(dayOfWeek)) status = "overtime";
            else if (checkInTimeStr > workStart && !hasAttendedToday) status = "late";

            // Resolve proper transport price
            const finalTransport = await fetchResolvedTransportPrice(data.employeeId, matchedSite.id, matchedSite.transportPrice, isRequest);

            // Use server Cairo time as the authoritative timestamp (ignores client clock manipulation)
            const serverTimestamp = getCairoISOString(serverNow);

            const payload = {
                employeeId: data.employeeId,
                employeeName: data.employeeName,
                siteId: matchedSite.id,
                siteName: matchedSite.name,
                checkIn: serverTimestamp,
                latitude: data.latitude,
                longitude: data.longitude,
                status: status,
                transportPrice: finalTransport,
                device_id: attendanceDeviceId
            };

            const { error } = await supabase.from('attendance').insert([payload]);
            if (error) throw error;

            // Sync to Google Sheets with actual server-generated data
            syncToGoogleSheet({ action: 'addAttendance', ...payload });

            return res.status(200).json({ success: true, message: "تم تسجيل الحضور بنجاح" });
        }

        // --- CHECK OUT ---
        if (action === "checkoutAttendance") {
            // 0. Biometric/PIN Check - BLOCK password-only authentication
            // Must have biometric data (face, fingerprint, or Face ID) - NO PIN/password fallback
            if (!data.biometricData && !data.faceDescriptor) {
                throw new Error("⚠️ مطلوب بصمة للتسجيل - لا يُسمح باستخدام PIN أو كلمة المرور للانصراف");
            }

            // Verify employee has biometric registered
            const { data: empBioData } = await supabase.from('employees')
                .select('"biometricType", "biometricData", "faceDescriptor"')
                .eq('id', String(data.employeeId))
                .maybeSingle();

            if (!empBioData) {
                throw new Error("⚠️ لم يتم تسجيل بصمة لهذا الموظف - يرجى التواصل مع HR");
            }

            // Check if employee has ANY biometric registered (face, fingerprint, or Face ID)
            const hasBiometric = empBioData.biometricData || empBioData.faceDescriptor;
            if (!hasBiometric) {
                throw new Error("⚠️ لم يتم تسجيل بصمة لهذا الموظف - يرجى التواصل مع HR لتسجيل الوجه أو البصمة");
            }

            // Support checkout by specific ID (for force-close) or latest open session
            let existing, errExist;
            if (data.attendanceId) {
                const result = await supabase.from('attendance')
                    .select('*')
                    .eq('id', data.attendanceId)
                    .limit(1);
                existing = result.data;
                errExist = result.error;
            } else {
                const result = await supabase.from('attendance')
                    .select('*')
                    .eq('employeeId', data.employeeId)
                    .is('checkOut', null)
                    .neq('status', 'no_checkout')
                    .order('checkIn', { ascending: false })
                    .limit(1);
                existing = result.data;
                errExist = result.error;
            }

            if (errExist || !existing || existing.length === 0) throw new Error("لا يوجد عملية حضور مفتوحة لنسجل الانصراف");

            const checkIn = new Date(existing[0].checkIn);
            // Use SERVER-SIDE Cairo time as authoritative checkout timestamp
            const serverCheckoutTime = getCairoISOString(new Date());
            const checkOut = new Date(serverCheckoutTime);

            // Check if trying to check out on a different day than check-in
            const checkInDate = checkIn.toDateString();
            const checkOutDate = checkOut.toDateString();

            if (checkInDate !== checkOutDate) {
                // Cannot check out on a different day - mark as no_checkout
                const eod = new Date(existing[0].checkIn);
                eod.setHours(23, 59, 59, 999);
                const preservedStatus = existing[0].status === 'overtime' ? 'overtime' : 'no_checkout';

                await supabase.from('attendance')
                    .update({ checkOut: eod.toISOString(), totalHours: 0, status: preservedStatus })
                    .eq('id', existing[0].id);

                throw new Error("لا يمكن تسجيل الانصراف في يوم مختلف عن يوم الحضور. تم تحديث السجل كـ 'لم يتم الانصراف'. يرجى تسجيل الحضور مرة أخرى لبدء يوم جديد.");
            }

            let totalHours = 0;
            if (!isNaN(checkIn) && !isNaN(checkOut)) {
                totalHours = parseFloat(((checkOut - checkIn) / 36e5).toFixed(2));
            }

            const { error } = await supabase.from('attendance')
                .update({
                    checkOut: serverCheckoutTime,
                    totalHours: totalHours,
                    status: existing[0].status // Keep the original status (overtime, late, present)
                })
                .eq('id', existing[0].id);
            if (error) throw error;

            // Sync to Google Sheets with actual server-generated data
            syncToGoogleSheet({
                action: 'checkoutAttendance',
                attendanceId: existing[0].id,
                employeeId: existing[0].employeeId,
                checkOut: serverCheckoutTime,
                totalHours: totalHours
            });

            return res.status(200).json({ success: true, message: "تم تسجيل الانصراف بنجاح" });
        }

        if (action === "adminCheckoutAttendance") {
            const { attendanceId, checkOutTime, adminName } = data;
            if (!attendanceId) return res.status(200).json({ success: false, message: "معرف السجل مطلوب" });

            const { data: existing, error: errExist } = await supabase.from('attendance')
                .select('*')
                .eq('id', attendanceId)
                .maybeSingle();

            if (errExist || !existing) return res.status(200).json({ success: false, message: "السجل غير موجود" });

            const checkIn = new Date(existing.checkIn);
            const finalCheckoutTime = checkOutTime || getCairoISOString(new Date());
            const checkOut = new Date(finalCheckoutTime);

            let totalHours = 0;
            if (!isNaN(checkIn) && !isNaN(checkOut)) {
                totalHours = parseFloat(((checkOut - checkIn) / 36e5).toFixed(2));
            }

            let finalStatus = existing.status;
            if (finalStatus === 'no_checkout' || !finalStatus) {
                const { data: setRows } = await supabase.from('settings').select('*').in('key', ['workStartTime', 'weekendDays']);
                let workStart = "09:00";
                let weekendDays = [5, 6];

                if (setRows && setRows.length > 0) {
                    const workStartRow = setRows.find(r => r.key === 'workStartTime');
                    if (workStartRow) workStart = workStartRow.value;

                    const weekendRow = setRows.find(r => r.key === 'weekendDays');
                    if (weekendRow && weekendRow.value) {
                        weekendDays = weekendRow.value.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
                    }
                }
                
                const checkInDateObj = new Date(existing.checkIn);
                const dayOfWeek = checkInDateObj.getDay();
                const checkInTimeStr = existing.checkIn.substring(11, 16);
                
                const checkInDateStr = existing.checkIn.substring(0, 10);
                const { data: holidayData } = await supabase.from('official_holidays').select('*').eq('holidayDate', checkInDateStr).maybeSingle();
                const isOfficialHoliday = holidayData !== null;

                if (isOfficialHoliday || weekendDays.includes(dayOfWeek)) {
                    finalStatus = "overtime";
                } else if (checkInTimeStr > workStart) {
                    finalStatus = "late";
                } else {
                    finalStatus = "present";
                }
            }

            const { error } = await supabase.from('attendance')
                .update({
                    checkOut: finalCheckoutTime,
                    totalHours: totalHours,
                    status: finalStatus
                })
                .eq('id', attendanceId);

            if (error) throw error;

            syncToGoogleSheet({
                action: 'checkoutAttendance',
                attendanceId: attendanceId,
                employeeId: existing.employeeId,
                checkOut: finalCheckoutTime,
                totalHours: totalHours
            });

            return res.status(200).json({ success: true, message: "تم تسجيل انصراف الموظف بنجاح" });
        }

        if (action === "applyAttendancePenalty") {
            const { attendanceId, penaltyAmount, adminName } = data;
            if (!attendanceId) return res.status(200).json({ success: false, message: "معرف السجل مطلوب" });
            if (penaltyAmount === undefined || isNaN(parseFloat(penaltyAmount))) {
                return res.status(200).json({ success: false, message: "قيمة الجزاء غير صالحة" });
            }

            const { error } = await supabase.from('attendance')
                .update({
                    penaltyAmount: parseFloat(penaltyAmount)
                })
                .eq('id', attendanceId);

            if (error) throw error;
            return res.status(200).json({ success: true, message: "تم تسجيل الجزاء بنجاح" });
        }

        if (action === "adminAddAttendance") {
            const { employeeId, siteId, date, checkInTime, checkOutTime } = data;
            if (!employeeId || !date || !checkInTime) {
                return res.status(200).json({ success: false, message: "بيانات الموظف والتاريخ ووقت الحضور مطلوبة" });
            }

            // 1. Fetch Employee
            const { data: emp, error: empErr } = await supabase.from('employees')
                .select('*')
                .eq('id', employeeId)
                .maybeSingle();
            if (empErr || !emp) {
                return res.status(200).json({ success: false, message: "الموظف غير موجود" });
            }

            // 2. Fetch Site
            let siteName = "موقع غير محدد";
            let transportPrice = 0;
            if (siteId) {
                const { data: site } = await supabase.from('sites').select('*').eq('id', siteId).maybeSingle();
                if (site) {
                    siteName = site.name;
                    try {
                        transportPrice = await fetchResolvedTransportPrice(employeeId, site.id, site.transportPrice, false);
                    } catch (e) {
                        transportPrice = parseFloat(site.transportPrice) || 0;
                    }
                }
            }

            // 3. Format ISO timestamps
            const checkInISO = new Date(`${date}T${checkInTime}:00`).toISOString();
            let checkOutISO = null;
            let totalHours = 0;

            if (checkOutTime) {
                checkOutISO = new Date(`${date}T${checkOutTime}:00`).toISOString();
                const diffMs = new Date(checkOutISO) - new Date(checkInISO);
                if (diffMs > 0) {
                    totalHours = parseFloat((diffMs / 36e5).toFixed(2));
                }
            }

            // 4. Calculate status
            const { data: setRows } = await supabase.from('settings').select('*').in('key', ['workStartTime', 'weekendDays']);
            let workStart = "09:00";
            let weekendDays = [5, 6];
            if (setRows && setRows.length > 0) {
                const workStartRow = setRows.find(r => r.key === 'workStartTime');
                if (workStartRow) workStart = workStartRow.value;
                const weekendRow = setRows.find(r => r.key === 'weekendDays');
                if (weekendRow && weekendRow.value) {
                    weekendDays = weekendRow.value.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
                }
            }

            const checkInDateObj = new Date(checkInISO);
            const dayOfWeek = checkInDateObj.getDay();
            const { data: holidayData } = await supabase.from('official_holidays').select('*').eq('holidayDate', date).maybeSingle();
            const isOfficialHoliday = holidayData !== null;

            let status = "present";
            if (isOfficialHoliday || weekendDays.includes(dayOfWeek)) {
                status = "overtime";
            } else if (checkInTime > workStart) {
                status = "late";
            }

            const payload = {
                employeeId: emp.id,
                employeeName: emp.name,
                siteId: siteId || null,
                siteName: siteName,
                checkIn: checkInISO,
                checkOut: checkOutISO,
                status: status,
                totalHours: totalHours,
                transportPrice: transportPrice,
                device_id: 'MANUAL_HR'
            };

            const { error: insErr } = await supabase.from('attendance').insert([payload]);
            if (insErr) throw insErr;

            try {
                syncToGoogleSheet({ action: 'addAttendance', ...payload });
            } catch (e) {
                console.error("Sheet sync error:", e);
            }

            return res.status(200).json({ success: true, message: "تم تسجيل الحضور اليدوي بنجاح" });
        }

        if (action === "adminUpdateAttendance") {
            const { attendanceId, employeeId, siteId, date, checkInTime, checkOutTime } = data;
            if (!attendanceId || !date || !checkInTime) {
                return res.status(200).json({ success: false, message: "معرف السجل والتاريخ ووقت الحضور مطلوبة" });
            }

            // 1. Fetch existing attendance record
            const { data: existingAtt, error: existErr } = await supabase.from('attendance')
                .select('*')
                .eq('id', attendanceId)
                .maybeSingle();

            if (existErr || !existingAtt) {
                return res.status(200).json({ success: false, message: "سجل الحضور غير موجود" });
            }

            const targetEmployeeId = employeeId || existingAtt.employeeId;

            // 2. Fetch Employee details if changed
            let employeeName = existingAtt.employeeName;
            if (targetEmployeeId !== existingAtt.employeeId) {
                const { data: emp } = await supabase.from('employees').select('*').eq('id', targetEmployeeId).maybeSingle();
                if (emp) employeeName = emp.name;
            }

            // 3. Fetch Site details
            let siteName = existingAtt.siteName;
            let transportPrice = existingAtt.transportPrice;
            if (siteId && siteId !== existingAtt.siteId) {
                const { data: site } = await supabase.from('sites').select('*').eq('id', siteId).maybeSingle();
                if (site) {
                    siteName = site.name;
                    try {
                        transportPrice = await fetchResolvedTransportPrice(targetEmployeeId, site.id, site.transportPrice, false);
                    } catch (e) {
                        transportPrice = parseFloat(site.transportPrice) || 0;
                    }
                }
            } else if (!siteId) {
                siteName = "موقع غير محدد";
                transportPrice = 0;
            }

            // 4. Format ISO timestamps
            const checkInISO = new Date(`${date}T${checkInTime}:00`).toISOString();
            let checkOutISO = null;
            let totalHours = 0;

            if (checkOutTime) {
                checkOutISO = new Date(`${date}T${checkOutTime}:00`).toISOString();
                const diffMs = new Date(checkOutISO) - new Date(checkInISO);
                if (diffMs > 0) {
                    totalHours = parseFloat((diffMs / 36e5).toFixed(2));
                }
            }

            // 5. Calculate status
            const { data: setRows } = await supabase.from('settings').select('*').in('key', ['workStartTime', 'weekendDays']);
            let workStart = "09:00";
            let weekendDays = [5, 6];
            if (setRows && setRows.length > 0) {
                const workStartRow = setRows.find(r => r.key === 'workStartTime');
                if (workStartRow) workStart = workStartRow.value;
                const weekendRow = setRows.find(r => r.key === 'weekendDays');
                if (weekendRow && weekendRow.value) {
                    weekendDays = weekendRow.value.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
                }
            }

            const checkInDateObj = new Date(checkInISO);
            const dayOfWeek = checkInDateObj.getDay();
            const { data: holidayData } = await supabase.from('official_holidays').select('*').eq('holidayDate', date).maybeSingle();
            const isOfficialHoliday = holidayData !== null;

            let status = "present";
            if (isOfficialHoliday || weekendDays.includes(dayOfWeek)) {
                status = "overtime";
            } else if (checkInTime > workStart) {
                status = "late";
            }

            const updatePayload = {
                employeeId: targetEmployeeId,
                employeeName: employeeName,
                siteId: siteId || null,
                siteName: siteName,
                checkIn: checkInISO,
                checkOut: checkOutISO,
                status: status,
                totalHours: totalHours,
                transportPrice: transportPrice
            };

            const { error: updErr } = await supabase.from('attendance')
                .update(updatePayload)
                .eq('id', attendanceId);

            if (updErr) throw updErr;

            try {
                syncToGoogleSheet({ action: 'updateAttendance', attendanceId, ...updatePayload });
            } catch (e) {
                console.error("Sheet sync error:", e);
            }

            return res.status(200).json({ success: true, message: "تم تعديل سجل الحضور بنجاح" });
        }

        // --- EMPLOYEE MGMT ---
        if (action === "getEmployees") {
            const cacheKey = 'employees';
            const cached = getCached(cacheKey);
            if (cached) return res.status(200).json({ success: true, data: cached });

            const { data: emps, error } = await supabase.from('employees').select('*');
            if (error) throw error;

            const { data: alls } = await supabase.from('siteAllowances').select('*');
            const employees = (emps || []).map(emp => ({
                ...emp,
                assignedSites: emp.assignedSites ? String(emp.assignedSites).split(',').map(s => s.trim()).filter(Boolean) : [],
                siteAllowances: (alls || []).filter(a => String(a.employeeId) === String(emp.id))
            }));

            setCached(cacheKey, employees, CACHE_TTL.employees);
            return res.status(200).json({ success: true, data: employees || [] });
        }

        if (action === "saveEmployee") {
            const allowances = data.siteAllowances || [];

            // Hash password before storing (in a real implementation, use bcrypt)
            // For this implementation, we'll simulate hashing with a simple transformation
            // NOTE: In production, use proper bcrypt hashing with salt
            const hashedPassword = data.password ? `$2b$10${Array(22).fill('0').join('').substring(0, 22)}${data.password}` : '';

            const payload = {
                id: data.id,
                name: data.name,
                email: data.email,
                phone: data.phone,
                password: hashedPassword,
                role: data.role || 'employee',
                assignedSites: data.assignedSites || '',
                faceDescriptor: data.faceDescriptor || null,
                biometricType: data.biometricType || (data.faceDescriptor ? 'face' : null),
                biometricData: data.biometricData || data.faceDescriptor || null,
                salary: data.salary || 0,
                transportPrice: data.transportPrice || 0
            };

            // 1. Save to employees table
            const { error: errEmp } = await supabase.from('employees').insert([payload]);
            if (errEmp) throw errEmp;

            // 2. Save site allowances if any
            if (allowances.length > 0) {
                const allowanceRows = allowances.map(a => ({
                    employeeId: data.id,
                    siteId: a.siteId,
                    transportPrice: a.transportPrice
                }));
                const { error: errAll } = await supabase.from('siteAllowances').insert(allowanceRows);
                if (errAll) console.error("Allowances Save Failed:", errAll);
            }

            invalidateCache('employees');
            return res.status(200).json({ success: true, message: "تمت إضافة الموظف بنجاح" });
        }

        if (action === "updateEmployee") {
            const allowances = data.siteAllowances || [];

            // Hash password before storing if it's being updated (in a real implementation, use bcrypt)
            // For this implementation, we'll simulate hashing with a simple transformation
            // NOTE: In production, use proper bcrypt hashing with salt
            let hashedPassword = data.password;
            if (data.password && !data.password.startsWith('$2b$')) {
                hashedPassword = `$2b$10${Array(22).fill('0').join('').substring(0, 22)}${data.password}`;
            }

            const payload = {
                name: data.name,
                email: data.email,
                phone: data.phone,
                role: data.role,
                assignedSites: data.assignedSites || '',
                salary: data.salary || 0,
                transportPrice: data.transportPrice || 0
            };

            if (data.faceDescriptor) payload.faceDescriptor = data.faceDescriptor;
            if (data.biometricType) payload.biometricType = data.biometricType;
            if (data.biometricData) payload.biometricData = data.biometricData;
            if (data.password) payload.password = hashedPassword;

            // 1. Update employees table
            const { error: errEmp } = await supabase.from('employees').update(payload).eq('id', data.id);
            if (errEmp) throw errEmp;

            // 2. Sync site allowances: Delete old, add new
            const { error: errDel } = await supabase.from('siteAllowances').delete().eq('employeeId', data.id);
            if (!errDel && allowances.length > 0) {
                const allowanceRows = allowances.map(a => ({
                    employeeId: data.id,
                    siteId: a.siteId,
                    transportPrice: a.transportPrice || 0
                }));
                await supabase.from('siteAllowances').insert(allowanceRows);
            }

            invalidateCache('employees');
            return res.status(200).json({ success: true, message: "تم تحديث بيانات الموظف بنجاح" });
        }

        if (action === "deleteEmployee") {
            const { error } = await supabase.from('employees').delete().eq('id', data.id);
            if (error) throw error;
            invalidateCache('employees');
            return res.status(200).json({ success: true, message: "تم حذف الموظف بنجاح" });
        }

        // --- SITE MGMT ---
        if (action === "getSites") {
            const cacheKey = 'sites';
            const cached = getCached(cacheKey);
            if (cached) return res.status(200).json({ success: true, data: cached });

            const { data: sites, error } = await supabase.from('sites').select('*').eq('isTemporary', false);
            if (error) throw error;
            setCached(cacheKey, sites, CACHE_TTL.sites);
            return res.status(200).json({ success: true, data: sites || [] });
        }

        if (action === "saveSite") {
            const payload = {
                id: data.id,
                name: data.name,
                latitude: data.latitude,
                longitude: data.longitude,
                radius: data.radius,
                mapLink: data.mapLink,
                isTemporary: false
            };
            const { error } = await supabase.from('sites').insert([payload]);
            if (error) throw error;

            const allowances = data.siteAllowances || [];
            if (allowances.length > 0) {
                const allowanceRows = allowances.map(a => ({
                    employeeId: a.employeeId,
                    siteId: String(data.id),
                    transportPrice: a.transportPrice
                }));
                const { error: errAll } = await supabase.from('siteAllowances').insert(allowanceRows);
                if (errAll) console.error("Allowances Save Failed:", errAll);
            }

            invalidateCache('sites');
            invalidateCache('employees');
            return res.status(200).json({ success: true, message: "تمت إضافة الموقع بنجاح" });
        }

        if (action === "updateSite") {
            const payload = {
                name: data.name,
                latitude: data.latitude,
                longitude: data.longitude,
                radius: data.radius,
                mapLink: data.mapLink
            };
            const { error } = await supabase.from('sites').update(payload).eq('id', data.id);
            if (error) throw error;

            const allowances = data.siteAllowances || [];
            const { error: errDel } = await supabase.from('siteAllowances').delete().eq('siteId', String(data.id));
            if (!errDel && allowances.length > 0) {
                const allowanceRows = allowances.map(a => ({
                    employeeId: a.employeeId,
                    siteId: String(data.id),
                    transportPrice: a.transportPrice || 0
                }));
                const { error: errAll } = await supabase.from('siteAllowances').insert(allowanceRows);
                if (errAll) console.error("Allowances Update Failed:", errAll);
            }

            invalidateCache('sites');
            invalidateCache('employees');
            return res.status(200).json({ success: true, message: "تم تحديث بيانات الموقع بنجاح" });
        }

        if (action === "deleteSite") {
            const { error: errDel } = await supabase.from('siteAllowances').delete().eq('siteId', String(data.id));
            if (errDel) console.error("Allowances Delete on Site Delete Failed:", errDel);
            const { error } = await supabase.from('sites').delete().eq('id', data.id);
            if (error) throw error;
            invalidateCache('sites');
            invalidateCache('employees');
            return res.status(200).json({ success: true, message: "تم حذف الموقع بنجاح" });
        }

        // --- SITE REQUESTS ---
        if (action === "getSiteRequests") {
            const { data: reqs, error } = await supabase.from('siteRequests').select('*');
            if (error) throw error;
            return res.status(200).json({ success: true, data: reqs || [] });
        }

        if (action === "addSiteRequest") {
            let mapLink = String(data.mapLink || "").trim();
            let mapLatitude = null;
            let mapLongitude = null;

            // Direct extraction from q=lat,lng if generated automatically by our client
            const qMatch = mapLink.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (qMatch) {
                mapLatitude = parseFloat(qMatch[1]);
                mapLongitude = parseFloat(qMatch[2]);
            } else if (mapLink) {
                try {
                    // Try to resolve redirected map link and extract lat/lng
                    const resLink = await fetch(mapLink, { method: 'HEAD', redirect: 'follow' });
                    const resolvedUrl = resLink.url;

                    // Basic extraction attempt from URL
                    const match = resolvedUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
                    if (match) {
                        mapLatitude = parseFloat(match[1]);
                        mapLongitude = parseFloat(match[2]);
                    }
                    mapLink = resolvedUrl;
                } catch (e) {
                    console.error("Map Link Resolution Failed:", e);
                }
            }

            // Fallback to coordinates provided directly in request if still unresolved or auto-generated
            if (mapLatitude === null || mapLongitude === null) {
                mapLatitude = parseFloat(data.latitude) || null;
                mapLongitude = parseFloat(data.longitude) || null;
            }

            const payload = {
                id: data.id || "REQ" + Math.floor(10000 + Math.random() * 90000),
                employeeId: data.employeeId,
                employeeName: data.employeeName,
                suggestedName: data.suggestedName,
                latitude: data.latitude,
                longitude: data.longitude,
                mapLink: mapLink,
                mapLatitude: mapLatitude,
                mapLongitude: mapLongitude,
                transportPrice: (data.transportPrice !== undefined && data.transportPrice !== null) ? data.transportPrice : 0,
                tempRadius: data.radius || 100,
                note: data.note,
                receiptUrl: data.receiptUrl,
                receiptName: data.receiptName || '',
                status: 'pending',
                timestamp: new Date().toISOString()
            };
            const { error } = await supabase.from('siteRequests').insert([payload]);
            if (error) throw error;

            // Create notification for HR
            await supabase.from('notifications').insert([{
                id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                userRole: 'hr',
                title: 'طلب موقع جديد',
                message: `قام الموظف ${data.employeeName} بطلب تسجيل موقع: ${data.suggestedName}`,
                type: 'site_request',
                relatedId: payload.id,
                isRead: false,
                createdAt: new Date().toISOString()
            }]);

            // Send email notification
            await sendRequestNotificationEmail(supabase, {
                type: 'site',
                employeeName: data.employeeName,
                details: `اسم الموقع المقترح: ${data.suggestedName}${data.note ? ' - ملاحظة: ' + data.note : ''}`,
                requestId: payload.id
            }, req.headers.host);

            return res.status(200).json({
                success: true,
                message: "تم إرسال طلب الموقع بنجاح. سيتم تفعيل الموافقة التلقائية خلال دقيقتين إذا كنت في الموقع."
            });
        }

        if (action === "approveSiteRequest") {
            const { id, name, transportPrice, radius, mode, mapLink, approvedBy } = data;

            // 1. Update Request table
            const { data: reqData, error: errFetch } = await supabase.from('siteRequests').select('*').eq('id', id).single();
            if (errFetch || !reqData) throw new Error("الطلب غير موجود");

            const finalStatus = (mode === 'daily' || mode === 'today') ? 'approved_today' : 'approved';
            const { error: errReq } = await supabase.from('siteRequests')
                .update({
                    status: finalStatus,
                    approvedAt: new Date().toISOString(),
                    transportPrice: transportPrice || reqData.transportPrice,
                    tempRadius: radius || reqData.tempRadius,
                    autoMeta: approvedBy || 'HR'
                })
                .eq('id', id);
            if (errReq) throw errReq;

            // 2. Add to sites table (always, but mark if temporary)
            const isTemp = (mode === 'daily' || mode === 'today');
            const sitePayload = {
                id: String(Math.floor(10000 + Math.random() * 90000)),
                name: name || reqData.suggestedName,
                latitude: reqData.latitude,
                longitude: reqData.longitude,
                radius: radius || 100,
                transportPrice: (transportPrice !== undefined && transportPrice !== null && transportPrice !== '') ? parseFloat(transportPrice) : 0,
                mapLink: mapLink || reqData.mapLink,
                isTemporary: isTemp
            };
            const { error: errSite } = await supabase.from('sites').insert([sitePayload]);
            if (errSite) throw errSite;

            // Notify employee
            const approvalType = isTemp ? 'لليوم فقط' : 'بشكل دائم';
            await supabase.from('notifications').insert([{
                id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                userId: reqData.employeeId,
                title: 'تمت الموافقة على موقعك',
                message: `تمت الموافقة على طلب تسجيل الموقع: ${name || reqData.suggestedName} ${approvalType}` + (approvedBy ? ` (بواسطة: ${approvedBy})` : ''),
                type: 'site_approved',
                relatedId: id,
                isRead: false,
                createdAt: new Date().toISOString()
            }]);

            return res.status(200).json({ success: true, message: "تمت الموافقة على الطلب بنجاح" });
        }

        if (action === "rejectSiteRequest") {
            const { id, approvedBy } = data;
            // Get request data first for notification
            const { data: reqData } = await supabase.from('siteRequests').select('*').eq('id', id).single();

            const { error } = await supabase.from('siteRequests')
                .update({
                    status: 'rejected',
                    autoMeta: approvedBy || 'HR'
                })
                .eq('id', id);
            if (error) throw error;

            // Notify employee
            if (reqData) {
                await supabase.from('notifications').insert([{
                    id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                    userId: reqData.employeeId,
                    title: 'تم رفض طلب موقعك',
                    message: `تم رفض طلب تسجيل الموقع: ${reqData.suggestedName}` + (approvedBy ? ` (بواسطة: ${approvedBy})` : ''),
                    type: 'site_rejected',
                    relatedId: id,
                    isRead: false,
                    createdAt: new Date().toISOString()
                }]);
            }

            return res.status(200).json({ success: true, message: "تم رفض الطلب بنجاح" });
        }

        if (action === "clearProcessedRequests") {
            // Delete all site requests that have been processed (approved, rejected, or expired)
            const { data: deletedData, error } = await supabase
                .from('siteRequests')
                .delete()
                .in('status', ['approved', 'approved_today', 'rejected'])
                .select();
            if (error) throw error;
            const count = deletedData ? deletedData.length : 0;
            return res.status(200).json({ success: true, message: `تم مسح ${count} طلب منتهي بنجاح` });
        }

        // --- ALLOWANCE UPGRADE SYSTEM ---
        if (action === "getEligibleAttendance") {
            const { employeeId, date } = data;
            // date comes as YYYY-MM-DD
            const { data: att, error } = await supabase
                .from('attendance')
                .select('*')
                .eq('employeeId', employeeId)
                .ilike('checkIn', `${date}%`);

            if (error) throw error;
            return res.status(200).json({ success: true, data: att || [] });
        }

        if (action === "addAllowanceRequest") {
            const allowanceId = "ALLOW" + Math.floor(10000 + Math.random() * 90000);
            const payload = {
                id: allowanceId,
                employeeId: data.employeeId,
                employeeName: data.employeeName,
                attendanceId: data.attendanceId,
                siteId: data.siteId,
                siteName: data.siteName,
                requestDate: data.requestDate,
                amount: parseFloat(data.amount),
                note: data.note,
                status: 'pending',
                createdAt: new Date().toISOString()
            };
            const { error } = await supabase.from('allowanceRequests').insert([payload]);
            if (error) throw error;

            // Create notification for HR
            await supabase.from('notifications').insert([{
                id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                userRole: 'hr',
                title: 'طلب زيادة بدلات جديد',
                message: `قام الموظف ${data.employeeName} بطلب زيادة بدلات بمبلغ ${data.amount} ج.م`,
                type: 'allowance_request',
                relatedId: payload.id || data.id,
                isRead: false,
                createdAt: new Date().toISOString()
            }]);

            // Send email notification
            await sendRequestNotificationEmail(supabase, {
                type: 'allowance',
                employeeName: data.employeeName,
                details: `مبلغ الزيادة: ${data.amount} ج.م - الموقع: ${data.siteName}${data.note ? ' - ملاحظة: ' + data.note : ''}`,
                requestId: payload.id || data.id
            }, req.headers.host);

            return res.status(200).json({ success: true, message: "تم إرسال طلب زيادة البدلات بنجاح" });
        }

        if (action === "getAllowanceRequests") {
            let query = supabase.from('allowanceRequests').select('*');
            if (data.employeeId) query = query.eq('employeeId', data.employeeId);
            const { data: reqs, error } = await query.order('createdAt', { ascending: false });
            if (error) throw error;
            return res.status(200).json({ success: true, data: reqs || [] });
        }

        if (action === "handleAllowanceRequest") {
            const { requestId, status, adminId, adminName, adminNote } = data;

            // 1. Fetch the request
            const { data: reqData, error: errReq } = await supabase
                .from('allowanceRequests')
                .select('*')
                .eq('id', requestId)
                .single();

            if (errReq || !reqData) throw new Error("الطلب غير موجود");
            if (reqData.status !== 'pending') throw new Error("تمت معالجة هذا الطلب مسبقاً");

            if (status === 'approved') {
                // 2. Fetch current attendance record
                const { data: attData, error: errAtt } = await supabase
                    .from('attendance')
                    .select('transportPrice')
                    .eq('id', reqData.attendanceId)
                    .single();

                if (errAtt || !attData) throw new Error("سجل الحضور المرتبط بالطلب غير موجود");

                const newPrice = parseFloat(attData.transportPrice || 0) + parseFloat(reqData.amount);

                // 3. Update attendance
                const { error: errUpdAtt } = await supabase
                    .from('attendance')
                    .update({ transportPrice: newPrice })
                    .eq('id', reqData.attendanceId);

                if (errUpdAtt) throw errUpdAtt;
            }

            // 4. Update request status
            const { error: errUpdReq } = await supabase
                .from('allowanceRequests')
                .update({
                    status: status,
                    approvedBy: adminName || 'HR Admin',
                    rejectionReason: status === 'rejected' ? (adminNote || 'تم الرفض بواسطة الإدارة') : '',
                    adminNote: adminNote || ''
                })
                .eq('id', requestId);

            if (errUpdReq) throw errUpdReq;

            // 5. Add Log
            const logId = "LOG" + Math.floor(10000 + Math.random() * 90000);
            await supabase.from('approvalLogs').insert([{
                id: logId,
                requestId: requestId,
                adminId: adminId,
                adminName: adminName,
                action: status,
                details: adminNote || (status === 'approved' ? 'تمت الموافقة على الطلب' : 'تم رفض الطلب'),
                timestamp: new Date().toISOString()
            }]);

            // 6. Notify employee
            const notifTitle = status === 'approved' ? 'تمت الموافقة على طلب زيادة البدلات' : 'تم رفض طلب زيادة البدلات';
            const notifMessage = status === 'approved'
                ? `تمت الموافقة على طلب زيادة البدلات بمبلغ ${reqData.amount} ج.م` + (adminName ? ` (بواسطة: ${adminName})` : '')
                : `تم رفض طلب زيادة البدلات بمبلغ ${reqData.amount} ج.م` + (adminName ? ` (بواسطة: ${adminName})` : '') + `${adminNote ? `. السبب: ${adminNote}` : ''}`;

            await supabase.from('notifications').insert([{
                id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                userId: reqData.employeeId,
                title: notifTitle,
                message: notifMessage,
                type: status === 'approved' ? 'allowance_approved' : 'allowance_rejected',
                relatedId: requestId,
                isRead: false,
                createdAt: new Date().toISOString()
            }]);

            return res.status(200).json({
                success: true,
                message: status === 'approved' ? "تمت الموافقة وتحديث البدلات بنجاح" : "تم رفض الطلب"
            });
        }

        if (action === "clearProcessedAllowances") {
            // Delete all allowance requests that have been processed (approved or rejected)
            const { data: deletedData, error } = await supabase
                .from('allowanceRequests')
                .delete()
                .in('status', ['approved', 'rejected'])
                .select();
            if (error) throw error;
            const count = deletedData ? deletedData.length : 0;
            return res.status(200).json({ success: true, message: `تم مسح ${count} طلب بدلات منتهي بنجاح` });
        }

        if (action === "deleteAllowanceRequest") {
            const { id } = data;
            const { error } = await supabase.from('allowanceRequests').delete().eq('id', id);
            if (error) throw error;
            return res.status(200).json({ success: true, message: "تم حذف طلب البدل بنجاح" });
        }

        // --- LEAVE REQUESTS ---
        if (action === "addLeaveRequest") {
            const { employeeId, employeeName, reason } = data;
            if (!reason) return res.status(200).json({ success: false, message: "سبب الإجازة مطلوب" });

            let periods = data.periods;
            if (!periods || !Array.isArray(periods)) {
                const singleStart = data.startDate || data.leaveDate;
                const singleEnd = data.endDate || data.leaveDate;
                if (!singleStart) return res.status(200).json({ success: false, message: "تاريخ البدء مطلوب" });
                periods = [{ startDate: singleStart, endDate: singleEnd }];
            }

            const dates = [];
            let totalDaysRange = 0;
            let displayDateText = "";

            for (const period of periods) {
                const { startDate, endDate } = period;
                const start = new Date(startDate);
                const end = new Date(endDate || startDate);

                if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                    return res.status(200).json({ success: false, message: "صيغة التاريخ غير صالحة" });
                }

                if (end < start) {
                    return res.status(200).json({ success: false, message: "تاريخ البدء يجب أن يكون قبل أو يساوي تاريخ الانتهاء" });
                }

                const diffTime = Math.abs(end - start);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                if (diffDays > 30) {
                    return res.status(200).json({ success: false, message: "لا يمكن تقديم طلب إجازة لأكثر من 30 يوماً في الفترة الواحدة" });
                }

                totalDaysRange += diffDays;

                let current = new Date(startDate);
                while (current <= end) {
                    dates.push(current.toISOString().split('T')[0]);
                    current.setDate(current.getDate() + 1);
                }
            }

            const uniqueDates = [...new Set(dates)];
            if (uniqueDates.length === 0) {
                return res.status(200).json({ success: false, message: "لم يتم تحديد أي فترات صالحة" });
            }

            // Fetch existing pending/approved requests for this employee in this range
            const { data: existingRequests, error: checkErr } = await supabase
                .from('leaveRequests')
                .select('leaveDate')
                .eq('employeeId', employeeId)
                .in('leaveDate', uniqueDates)
                .in('status', ['pending', 'approved']);

            if (checkErr) throw checkErr;

            const existingDates = new Set(existingRequests.map(r => r.leaveDate.split('T')[0]));

            // Filter dates to insert (only those that do not already have a pending/approved request)
            const datesToInsert = uniqueDates.filter(d => !existingDates.has(d));

            if (datesToInsert.length === 0) {
                return res.status(200).json({ success: false, message: "لديك طلبات إجازة موجودة بالفعل لجميع التواريخ المحددة" });
            }

            const payloads = datesToInsert.map(d => ({
                id: "LEAVE" + Math.floor(10000 + Math.random() * 90000),
                employeeId,
                employeeName,
                leaveDate: d,
                reason,
                status: 'pending',
                createdAt: new Date().toISOString()
            }));

            const { error } = await supabase.from('leaveRequests').insert(payloads);
            if (error) throw error;

            // Display text for notification/email
            if (periods.length === 1) {
                const startDate = periods[0].startDate;
                const endDate = periods[0].endDate || startDate;
                const diffTime = Math.abs(new Date(endDate) - new Date(startDate));
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                displayDateText = diffDays === 1 ? `بتاريخ ${startDate}` : `من تاريخ ${startDate} إلى ${endDate} (${payloads.length} يوم عمل فعلي)`;
            } else {
                displayDateText = `لفترات متفرقة تشمل ${payloads.length} يوم عمل فعلي (التواريخ: ${datesToInsert.join(', ')})`;
            }

            const mainRequestId = payloads[0].id;

            await supabase.from('notifications').insert([{
                id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                userRole: 'hr',
                title: 'طلب إجازة جديد',
                message: `قام الموظف ${employeeName} بطلب إجازة ${displayDateText}`,
                type: 'leave_request',
                relatedId: mainRequestId,
                isRead: false,
                createdAt: new Date().toISOString()
            }]);

            // Send email notification
            await sendRequestNotificationEmail(supabase, {
                type: 'leave',
                employeeName,
                details: `فترات الإجازة: ${displayDateText} - نوع الإجازة: ${reason}`,
                requestId: mainRequestId
            }, req.headers.host);

            // Sync to Google Sheets for each date individually
            for (const d of datesToInsert) {
                syncToGoogleSheet({
                    action: 'addLeaveRequest',
                    employeeId,
                    employeeName,
                    leaveDate: d,
                    reason
                });
            }

            const resultMsg = payloads.length === 1
                ? "تم تقديم طلب الإجازة بنجاح"
                : `تم تقديم طلب الإجازة لعدد ${payloads.length} أيام بنجاح. (تم تجاهل الأيام المسجلة مسبقاً إن وجدت)`;

            return res.status(200).json({ success: true, message: resultMsg });
        }

        if (action === "getLeaveRequests") {
            let query = supabase.from('leaveRequests').select('*');
            if (data.employeeId) query = query.eq('employeeId', data.employeeId);
            const { data: reqs, error } = await query.order('createdAt', { ascending: false });
            if (error) throw error;
            return res.status(200).json({ success: true, data: reqs || [] });
        }

        if (action === "approveLeaveRequest") {
            const { id, approvedBy } = data;

            // Get the request first to notify employee
            const { data: req, error: getErr } = await supabase.from('leaveRequests').select('*').eq('id', id).single();
            if (getErr) throw getErr;

            const { error } = await supabase.from('leaveRequests').update({
                status: 'approved',
                approvedAt: new Date().toISOString(),
                approvedBy: approvedBy || 'HR'
            }).eq('id', id);
            if (error) throw error;

            // Notify employee
            await supabase.from('notifications').insert([{
                id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                userId: req.employeeId,
                title: 'تمت الموافقة على إجازتك',
                message: `تمت الموافقة على طلب إجازتك بتاريخ ${req.leaveDate}`,
                type: 'leave_approved',
                relatedId: id,
                isRead: false,
                createdAt: new Date().toISOString()
            }]);

            return res.status(200).json({ success: true, message: "تمت الموافقة على طلب الإجازة بنجاح" });
        }

        if (action === "rejectLeaveRequest") {
            const { id, rejectionReason } = data;

            // Get the request first to notify employee
            const { data: req, error: getErr } = await supabase.from('leaveRequests').select('*').eq('id', id).single();
            if (getErr) throw getErr;

            const { error } = await supabase.from('leaveRequests').update({
                status: 'rejected',
                rejectionReason: rejectionReason || ''
            }).eq('id', id);
            if (error) throw error;

            // Notify employee
            await supabase.from('notifications').insert([{
                id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                userId: req.employeeId,
                title: 'تم رفض طلب إجازتك',
                message: `تم رفض طلب إجازتك بتاريخ ${req.leaveDate}${rejectionReason ? `. السبب: ${rejectionReason}` : ''}`,
                type: 'leave_rejected',
                relatedId: id,
                isRead: false,
                createdAt: new Date().toISOString()
            }]);

            return res.status(200).json({ success: true, message: "تم رفض طلب الإجازة" });
        }

        if (action === "deleteLeaveRequest") {
            const { id } = data;
            const { error } = await supabase.from('leaveRequests').delete().eq('id', id);
            if (error) throw error;
            return res.status(200).json({ success: true, message: "تم حذف طلب الإجازة بنجاح" });
        }

        if (action === "clearProcessedLeaveRequests") {
            const { data: deletedData, error } = await supabase
                .from('leaveRequests')
                .delete()
                .in('status', ['approved', 'rejected'])
                .select();
            if (error) throw error;
            const count = deletedData ? deletedData.length : 0;
            return res.status(200).json({ success: true, message: `تم مسح ${count} طلب إجازة منتهي بنجاح` });
        }

        // --- NOTIFICATIONS ---
        if (action === "getNotifications") {
            const { userId, userRole } = data;

            let query = supabase.from('notifications').select('*').eq('isRead', false);

            if (userId) query = query.eq('userId', userId);
            else if (userRole) query = query.eq('userRole', userRole);
            else return res.status(200).json({ success: false, message: "userId أو userRole مطلوب" });

            const { data: notifs, error } = await query.order('createdAt', { ascending: false });
            if (error) throw error;

            return res.status(200).json({ success: true, notifications: notifs || [], count: notifs?.length || 0 });
        }

        if (action === "markNotificationAsRead") {
            const { notificationId } = data;

            const { error } = await supabase.from('notifications').update({
                isRead: true,
                readAt: new Date().toISOString()
            }).eq('id', notificationId);
            if (error) throw error;

            return res.status(200).json({ success: true, message: "تم تحديث الإشعار" });
        }

        if (action === "markAllNotificationsAsRead") {
            const { userId, userRole } = data;

            let query = supabase.from('notifications').update({
                isRead: true,
                readAt: new Date().toISOString()
            }).eq('isRead', false);

            if (userId) query = query.eq('userId', userId);
            else if (userRole) query = query.eq('userRole', userRole);

            const { error, data: updated } = await query;
            if (error) throw error;

            return res.status(200).json({ success: true, message: `تم تحديث ${updated?.length || 0} إشعار` });
        }

        // --- OFFICIAL HOLIDAYS ---
        if (action === "getOfficialHolidays") {
            const cacheKey = 'holidays';
            const cached = getCached(cacheKey);
            if (cached) return res.status(200).json({ success: true, data: cached });

            const { data: holidays, error } = await supabase.from('official_holidays').select('*').order('holidayDate', { ascending: true });
            if (error) throw error;

            setCached(cacheKey, holidays, CACHE_TTL.holidays);
            return res.status(200).json({ success: true, data: holidays || [] });
        }

        if (action === "addOfficialHoliday") {
            const { holidayDate, holidayName } = data;
            if (!holidayDate || !holidayName) {
                return res.status(200).json({ success: false, message: "تاريخ واسم الإجازة مطلوبان" });
            }
            const payload = {
                holidayDate: holidayDate,
                holidayName: holidayName,
                createdAt: new Date().toISOString()
            };
            const { error } = await supabase.from('official_holidays').insert([payload]);
            if (error) {
                if (error.code === '23505') {
                    return res.status(200).json({ success: false, message: "هذا التاريخ مسجل كإجازة رسمية مسبقاً" });
                }
                throw error;
            }

            // Update existing attendance records on this date to overtime
            const holidayStart = new Date(holidayDate);
            holidayStart.setHours(0, 0, 0, 0);
            const holidayEnd = new Date(holidayDate);
            holidayEnd.setHours(23, 59, 59, 999);

            const { data: attRecords } = await supabase.from('attendance')
                .select('id')
                .gte('checkIn', holidayStart.toISOString())
                .lte('checkIn', holidayEnd.toISOString());

            if (attRecords && attRecords.length > 0) {
                const idsToUpdate = attRecords.map(r => r.id);
                await supabase.from('attendance')
                    .update({ status: 'overtime' })
                    .in('id', idsToUpdate);
            }

            invalidateCache('holidays');
            return res.status(200).json({ success: true, message: "تم إضافة الإجازة الرسمية بنجاح وتحديث السجلات" });
        }

        if (action === "deleteOfficialHoliday") {
            const { id } = data;
            if (!id) {
                return res.status(200).json({ success: false, message: "معرف الإجازة مطلوب" });
            }

            // Get the holiday date before deleting
            const { data: holiday } = await supabase.from('official_holidays').select('holidayDate').eq('id', id).single();
            if (!holiday) {
                return res.status(200).json({ success: false, message: "الإجازة غير موجودة" });
            }

            const { error } = await supabase.from('official_holidays').delete().eq('id', id);
            if (error) throw error;

            // Re-calculate status for attendance records on this date
            const holidayDate = holiday.holidayDate;
            const holidayStart = new Date(holidayDate);
            holidayStart.setHours(0, 0, 0, 0);
            const holidayEnd = new Date(holidayDate);
            holidayEnd.setHours(23, 59, 59, 999);

            // Get settings for work start time and weekend days
            const { data: setRows } = await supabase.from('settings').select('*').in('key', ['workStartTime', 'weekendDays']);
            let workStart = "09:00";
            let weekendDays = [5, 6]; // Default: Friday, Saturday

            if (setRows && setRows.length > 0) {
                const workStartRow = setRows.find(r => r.key === 'workStartTime');
                if (workStartRow) workStart = workStartRow.value;

                const weekendRow = setRows.find(r => r.key === 'weekendDays');
                if (weekendRow && weekendRow.value) {
                    weekendDays = weekendRow.value.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
                }
            }

            const { data: attRecords } = await supabase.from('attendance')
                .select('*')
                .gte('checkIn', holidayStart.toISOString())
                .lte('checkIn', holidayEnd.toISOString());

            if (attRecords && attRecords.length > 0) {
                for (const record of attRecords) {
                    const checkInDate = new Date(record.checkIn);
                    const dayOfWeek = checkInDate.getDay();
                    const checkInTimeStr = checkInDate.toTimeString().slice(0, 5);

                    let newStatus = "present";
                    if (weekendDays.includes(dayOfWeek)) {
                        newStatus = "overtime";
                    } else if (checkInTimeStr > workStart) {
                        newStatus = "late";
                    }

                    await supabase.from('attendance')
                        .update({ status: newStatus })
                        .eq('id', record.id);
                }
            }

            invalidateCache('holidays');
            return res.status(200).json({ success: true, message: "تم حذف الإجازة الرسمية بنجاح وتحديث السجلات" });
        }

        // --- SETTINGS ---
        if (action === "getSettings") {
            const cacheKey = 'settings';
            const cached = getCached(cacheKey);
            if (cached) return res.status(200).json({ success: true, data: cached });

            const { data: sets, error } = await supabase.from('settings').select('*');
            if (error) throw error;
            let settings = {};
            if (sets) sets.forEach(s => settings[s.key] = s.value);
            setCached(cacheKey, settings, CACHE_TTL.settings);
            return res.status(200).json({ success: true, data: settings });
        }

        if (action === "updateSettings") {
            const settings = data.settings;
            const promises = Object.entries(settings).map(([key, value]) => {
                return supabase.from('settings').upsert({ key, value }, { onConflict: 'key' });
            });
            await Promise.all(promises);
            invalidateCache('settings');
            return res.status(200).json({ success: true, message: "تم تحديث الإعدادات بنجاح" });
        }

        // --- PAYMENT OF ALLOWANCES ---
        if (action === "payAttendanceAllowance") {
            const { attendanceId, adminName, amount } = data;
            if (!attendanceId) {
                return res.status(200).json({ success: false, message: "معرف السجل مطلوب" });
            }
            const { error } = await supabase.from('attendance')
                .update({
                    isPaid: true,
                    paidAmount: parseFloat(amount || 0),
                    paidAt: getCairoISOString(new Date()),
                    paidBy: adminName || 'System Admin'
                })
                .eq('id', attendanceId);

            if (error) throw error;
            return res.status(200).json({ success: true, message: "تم تسجيل سداد البدل بنجاح" });
        }

        if (action === "payAttendanceAllowancePeriod") {
            const { employeeId, startDate, endDate, adminName } = data;
            if (!employeeId || !startDate || !endDate) {
                return res.status(200).json({ success: false, message: "البيانات المطلوبة ناقصة" });
            }

            // 1. Fetch all attendance records for this period
            const { data: unpaidRecords, error: fetchErr } = await supabase.from('attendance')
                .select('*')
                .eq('employeeId', employeeId)
                .gte('checkIn', startDate + 'T00:00:00')
                .lte('checkIn', endDate + 'T23:59:59');

            if (fetchErr) throw fetchErr;

            // Filter locally for records that are not paid
            const recordsToPay = (unpaidRecords || []).filter(r => !r.isPaid);

            if (recordsToPay.length === 0) {
                return res.status(200).json({ success: true, message: "لا توجد بدلات غير مسددة في هذه الفترة", count: 0 });
            }

            // 2. Perform bulk update
            const nowStr = getCairoISOString(new Date());
            const promises = recordsToPay.map(r => {
                const amount = parseFloat(r.transportPrice || 0);
                return supabase.from('attendance')
                    .update({
                        isPaid: true,
                        paidAmount: amount,
                        paidAt: nowStr,
                        paidBy: adminName || 'System Admin'
                    })
                    .eq('id', r.id);
            });

            await Promise.all(promises);

            return res.status(200).json({
                success: true,
                message: `تم تسجيل سداد عدد ${recordsToPay.length} بدل بنجاح`,
                count: recordsToPay.length
            });
        }

        if (action === "rollbackAttendanceAllowancePeriod") {
            const { employeeId, startDate, endDate } = data;
            if (!employeeId || !startDate || !endDate) {
                return res.status(200).json({ success: false, message: "البيانات المطلوبة ناقصة" });
            }

            // 1. Fetch all attendance records for this period
            const { data: records, error: fetchErr } = await supabase.from('attendance')
                .select('*')
                .eq('employeeId', employeeId)
                .gte('checkIn', startDate + 'T00:00:00')
                .lte('checkIn', endDate + 'T23:59:59');

            if (fetchErr) throw fetchErr;

            // Filter locally for records that are paid
            const recordsToRollback = (records || []).filter(r => r.isPaid);

            if (recordsToRollback.length === 0) {
                return res.status(200).json({ success: true, message: "لا توجد بدلات مسددة في هذه الفترة لإلغائها", count: 0 });
            }

            // 2. Perform bulk update
            const promises = recordsToRollback.map(r => {
                return supabase.from('attendance')
                    .update({
                        isPaid: false,
                        paidAmount: 0,
                        paidAt: null,
                        paidBy: null
                    })
                    .eq('id', r.id);
            });

            await Promise.all(promises);

            return res.status(200).json({
                success: true,
                message: `تم إلغاء سداد عدد ${recordsToRollback.length} بدل بنجاح`,
                count: recordsToRollback.length
            });
        }

        if (action === "rollbackAttendanceAllowance") {
            const { attendanceId } = data;
            if (!attendanceId) {
                return res.status(200).json({ success: false, message: "معرف السجل مطلوب" });
            }
            const { error } = await supabase.from('attendance')
                .update({
                    isPaid: false,
                    paidAmount: 0,
                    paidAt: null,
                    paidBy: null
                })
                .eq('id', attendanceId);

            if (error) throw error;
            return res.status(200).json({ success: true, message: "تم إلغاء تسجيل سداد البدل بنجاح" });
        }

        // --- DATABASE MONITORING ---
        if (action === "getDatabaseStats") {
            // Get table row counts
            const [
                { count: attendanceCount, error: attErr },
                { count: employeesCount, error: empErr },
                { count: sitesCount, error: siteErr },
                { count: siteRequestsCount, error: reqErr },
                { count: allowanceRequestsCount, error: allErr },
                { count: holidaysCount, error: holErr }
            ] = await Promise.all([
                supabase.from('attendance').select('*', { count: 'exact', head: true }),
                supabase.from('employees').select('*', { count: 'exact', head: true }),
                supabase.from('sites').select('*', { count: 'exact', head: true }),
                supabase.from('siteRequests').select('*', { count: 'exact', head: true }),
                supabase.from('allowanceRequests').select('*', { count: 'exact', head: true }),
                supabase.from('official_holidays').select('*', { count: 'exact', head: true })
            ]);

            // Get database size using pg_size_pretty
            const { data: sizeData, error: sizeError } = await supabase
                .rpc('get_database_size');

            const stats = {
                tables: {
                    attendance: attendanceCount || 0,
                    employees: employeesCount || 0,
                    sites: sitesCount || 0,
                    siteRequests: siteRequestsCount || 0,
                    allowanceRequests: allowanceRequestsCount || 0,
                    officialHolidays: holidaysCount || 0
                },
                databaseSize: sizeData ? Math.round(sizeData / 1024 / 1024 * 100) / 100 : null,
                freeTierLimit: 500,
                usagePercent: sizeData ? Math.round((sizeData / (500 * 1024 * 1024)) * 100) : null,
                status: sizeData && sizeData < (450 * 1024 * 1024) ? 'healthy' :
                    sizeData && sizeData < (480 * 1024 * 1024) ? 'warning' : 'critical'
            };

            return res.status(200).json({ success: true, data: stats });
        }

        // --- BACKUP & DISASTER RECOVERY SYSTEM ---
        if (action === "getBackupStatus") {
            const [
                { count: sbEmpCount },
                { count: sbSiteCount },
                { count: sbAttCount }
            ] = await Promise.all([
                supabase.from('employees').select('*', { count: 'exact', head: true }),
                supabase.from('sites').select('*', { count: 'exact', head: true }),
                supabase.from('attendance').select('*', { count: 'exact', head: true })
            ]);

            let gsEmpCount = null;
            let gsOnline = false;

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 7000);
                const gsRes = await fetch(`${GOOGLE_SCRIPT_URL}?action=getEmployees`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (gsRes.ok) {
                    const gsData = await gsRes.json();
                    if (gsData.success && Array.isArray(gsData.data)) {
                        gsEmpCount = gsData.data.length;
                        gsOnline = true;
                    }
                }
            } catch (e) {
                console.error("Failed to check Google Sheets status:", e?.message || e);
            }

            const isSynced = gsOnline && (sbEmpCount === gsEmpCount);

            return res.status(200).json({
                success: true,
                supabase: {
                    employees: sbEmpCount || 0,
                    sites: sbSiteCount || 0,
                    attendance: sbAttCount || 0
                },
                googleSheets: {
                    online: gsOnline,
                    employees: gsEmpCount,
                    url: GOOGLE_SCRIPT_URL
                },
                isSynced,
                message: isSynced 
                    ? "النسخة الاحتياطية متطابقة بنسبة 100% مع قاعدة البيانات." 
                    : (gsOnline 
                        ? `يوجد اختلاف: Supabase به (${sbEmpCount || 0}) موظف بينما Google Sheets به (${gsEmpCount || 0}) موظف. يرجى المزامنة.`
                        : "تعذر الاتصال بـ Google Sheets حالياً.")
            });
        }

        if (action === "triggerFullBackup") {
            // 1. Fetch live tables from Supabase
            const employees = await fetchAllRows('employees', '*');
            const sites = await fetchAllRows('sites', '*');
            const allowances = await fetchAllRows('siteAllowances', '*');
            const { data: settingsRows } = await supabase.from('settings').select('*');

            const settings = {};
            if (settingsRows) {
                settingsRows.forEach(r => { settings[r.key] = r.value; });
            }

            // 2. Prepare payload
            const backupPayload = {
                action: 'syncFullBackup',
                employees: employees.map(e => ({
                    id: e.id,
                    name: e.name,
                    email: e.email,
                    password: e.password,
                    phone: e.phone,
                    role: e.role,
                    assignedSites: e.assignedSites,
                    faceDescriptor: e.faceDescriptor,
                    transportPrice: e.transportPrice
                })),
                sites: sites.map(s => ({
                    id: s.id,
                    name: s.name,
                    latitude: s.latitude,
                    longitude: s.longitude,
                    radius: s.radius,
                    transportPrice: s.transportPrice,
                    mapLink: s.mapLink
                })),
                settings: settings,
                siteAllowances: allowances.map(a => ({
                    employeeId: a.employeeId,
                    siteId: a.siteId,
                    transportPrice: a.transportPrice
                }))
            };

            let gsResponseData = null;
            let syncMethod = "batch";

            // Try fast batch endpoint first
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 25000);
                const gsRes = await fetch(GOOGLE_SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify(backupPayload),
                    headers: { 'Content-Type': 'text/plain' },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (gsRes.ok) {
                    gsResponseData = await gsRes.json();
                }
            } catch (err) {
                console.warn("Batch syncFullBackup error:", err?.message || err);
            }

            // Fallback: If batch sync is not supported or failed, sync missing employees individually
            if (!gsResponseData || !gsResponseData.success) {
                syncMethod = "individual-sync";
                let addedCount = 0;
                try {
                    const sheetCheckRes = await fetch(`${GOOGLE_SCRIPT_URL}?action=getEmployees`);
                    const sheetJson = await sheetCheckRes.json();
                    const existingSheetEmpIds = new Set((sheetJson.data || []).map(r => String(r.id)));

                    for (const emp of backupPayload.employees) {
                        if (!existingSheetEmpIds.has(String(emp.id))) {
                            await syncToGoogleSheet({
                                action: "saveEmployee",
                                id: emp.id,
                                name: emp.name,
                                email: emp.email,
                                password: emp.password || "123456",
                                phone: emp.phone,
                                role: emp.role,
                                assignedSites: emp.assignedSites,
                                faceDescriptor: emp.faceDescriptor,
                                transportPrice: emp.transportPrice
                            });
                            addedCount++;
                        }
                    }
                    gsResponseData = {
                        success: true,
                        message: `تمت المزامنة بنجاح! تم فحص (${backupPayload.employees.length}) موظف، وإضافة (${addedCount}) موظف ناقص إلى Google Sheets.`,
                        addedCount
                    };
                } catch (fallbackErr) {
                    throw new Error(`تعذر الاتصال بخادم النسخ الاحتياطي: ${fallbackErr.message}`);
                }
            }

            return res.status(200).json({
                success: true,
                message: gsResponseData?.message || "تمت مزامنة النسخة الاحتياطية بنجاح",
                syncMethod,
                stats: {
                    employeesCount: employees.length,
                    sitesCount: sites.length,
                    allowancesCount: allowances.length
                },
                details: gsResponseData
            });
        }

        if (action === "exportFullBackup") {
            const [
                employees,
                sites,
                attendance,
                siteRequests,
                leaveRequests,
                allowanceRequests,
                siteAllowances,
                notifications,
                holidays,
                { data: settingsRows }
            ] = await Promise.all([
                fetchAllRows('employees', '*'),
                fetchAllRows('sites', '*'),
                fetchAllRows('attendance', '*'),
                fetchAllRows('siteRequests', '*'),
                fetchAllRows('leaveRequests', '*'),
                fetchAllRows('allowanceRequests', '*'),
                fetchAllRows('siteAllowances', '*'),
                fetchAllRows('notifications', '*'),
                fetchAllRows('official_holidays', '*'),
                supabase.from('settings').select('*')
            ]);

            const settings = {};
            if (settingsRows) {
                settingsRows.forEach(r => { settings[r.key] = r.value; });
            }

            return res.status(200).json({
                success: true,
                exportedAt: new Date().toISOString(),
                counts: {
                    employees: employees.length,
                    sites: sites.length,
                    attendance: attendance.length,
                    siteRequests: siteRequests.length,
                    leaveRequests: leaveRequests.length,
                    allowanceRequests: allowanceRequests.length,
                    siteAllowances: siteAllowances.length,
                    notifications: notifications.length,
                    officialHolidays: holidays.length
                },
                data: {
                    employees,
                    sites,
                    attendance,
                    siteRequests,
                    leaveRequests,
                    allowanceRequests,
                    siteAllowances,
                    notifications,
                    officialHolidays: holidays,
                    settings
                }
            });
        }

        // ============================================
        // DEVICE MANAGEMENT SYSTEM
        // ============================================

        // --- SUBMIT DEVICE CHANGE REQUEST (Employee) ---
        if (action === "submitDeviceChangeRequest") {
            const { employeeId, employeeName, currentDeviceId, newDeviceInfo, reason } = data;

            if (!employeeId || !newDeviceInfo?.deviceId) {
                return res.status(200).json({ success: false, message: "بيانات غير مكتملة" });
            }

            const result = await createDeviceChangeRequest(
                supabase,
                employeeId,
                employeeName,
                currentDeviceId,
                newDeviceInfo,
                reason,
                req.headers.host
            );

            return res.status(200).json(result);
        }

        // --- SEND REQUEST REMINDER (Employee) ---
        if (action === "sendRequestReminder") {
            const { requestId, requestType, employeeId, employeeName } = data;

            if (!requestId || !requestType || !employeeId) {
                return res.status(200).json({ success: false, message: "بيانات غير مكتملة" });
            }

            let requestTable = '';
            if (requestType === 'leave') requestTable = 'leaveRequests';
            else if (requestType === 'allowance') requestTable = 'allowanceRequests';
            else if (requestType === 'site') requestTable = 'siteRequests';
            else if (requestType === 'device') requestTable = 'device_change_requests';
            else {
                return res.status(200).json({ success: false, message: "نوع الطلب غير صحيح" });
            }

            // Fetch request details
            const { data: request, error: fetchError } = await supabase
                .from(requestTable)
                .select('*')
                .eq('id', requestId)
                .maybeSingle();

            if (fetchError || !request) {
                return res.status(200).json({ success: false, message: "الطلب غير موجود" });
            }

            if (request.status !== 'pending') {
                return res.status(200).json({ success: false, message: "لا يمكن إرسال تذكير لطلب غير معلق" });
            }

            // Rate-limit reminders: check if a reminder was sent in the last 10 minutes
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            const { data: recentNotifs } = await supabase
                .from('notifications')
                .select('createdAt')
                .eq('relatedId', requestId)
                .eq('type', 'request_reminder')
                .gte('createdAt', tenMinutesAgo);

            if (recentNotifs && recentNotifs.length > 0) {
                return res.status(200).json({ success: false, message: "لقد قمت بإرسال تذكير مؤخراً. يرجى الانتظار قليلاً قبل المحاولة مرة أخرى." });
            }

            // Format details for notification and email
            let details = '';
            const typeLabels = {
                'leave': 'طلب إجازة',
                'site': 'طلب تسجيل موقع جديد',
                'allowance': 'طلب زيادة بدلات',
                'device': 'طلب تغيير جهاز'
            };
            const typeLabel = typeLabels[requestType] || 'طلب معلق';

            if (requestType === 'leave') {
                details = `تاريخ الإجازة: ${request.leaveDate} - السبب: ${request.reason}`;
            } else if (requestType === 'allowance') {
                details = `الموقع: ${request.siteName || '-'} - المبلغ: ${request.amount} ج.م - ملاحظة: ${request.note || 'لا يوجد'}`;
            } else if (requestType === 'site') {
                details = `اسم الموقع المقترح: ${request.suggestedName} - ملاحظة: ${request.note || 'لا يوجد'}`;
            } else if (requestType === 'device') {
                details = `الجهاز الجديد: ${request.new_device_model || 'غير معروف'} - سبب التغيير: ${request.reason || 'لا يوجد'}`;
            }

            // Insert notification for HR
            const notifId = "NOTIF" + Math.floor(10000 + Math.random() * 90000);
            const dateVal = request.createdAt || request.timestamp || request.created_at;
            const formattedDate = new Date(dateVal).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' });

            const { error: notifError } = await supabase.from('notifications').insert([{
                id: notifId,
                userRole: 'hr',
                title: 'تذكير بطلب معلق',
                message: `تذكير: الموظف ${employeeName} يذكرك بـ ${typeLabel} المعلق المقدم بتاريخ ${formattedDate}`,
                type: 'request_reminder',
                relatedId: requestId,
                isRead: false,
                createdAt: new Date().toISOString()
            }]);

            if (notifError) throw notifError;

            // Send email notification to HR
            try {
                await sendReminderNotificationEmail(supabase, {
                    type: requestType,
                    employeeName: employeeName,
                    details: details,
                    requestId: requestId
                }, req.headers.host);
            } catch (emailErr) {
                console.error("Error sending reminder email:", emailErr);
            }

            return res.status(200).json({ success: true, message: "تم إرسال التذكير بنجاح للإدارة" });
        }

        // --- GET DEVICE CHANGE REQUESTS (Admin) ---
        if (action === "getDeviceChangeRequests") {
            const { status } = data;
            let query = supabase
                .from('device_change_requests')
                .select('*')
                .order('created_at', { ascending: false });

            if (status) {
                query = query.eq('status', status);
            }

            const { data: requests, error } = await query;
            if (error) throw error;

            return res.status(200).json({ success: true, data: requests || [] });
        }

        // --- APPROVE DEVICE CHANGE REQUEST (Admin) ---
        if (action === "approveDeviceChangeRequest") {
            const { requestId, adminId, adminName } = data;

            // 1. Get the request
            const { data: request, error: reqError } = await supabase
                .from('device_change_requests')
                .select('*')
                .eq('id', requestId)
                .single();

            if (reqError || !request) {
                return res.status(200).json({ success: false, message: "الطلب غير موجود" });
            }

            if (request.status !== 'pending') {
                return res.status(200).json({ success: false, message: "تمت معالجة هذا الطلب مسبقاً" });
            }

            // 2. Deactivate old device (if exists)
            if (request.old_device_id) {
                await supabase
                    .from('devices')
                    .update({ is_active: false, updated_at: new Date().toISOString() })
                    .eq('user_id', request.user_id)
                    .eq('device_id', request.old_device_id);
            }

            // 3. Deactivate any other active devices for this user
            await supabase
                .from('devices')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('user_id', request.user_id)
                .eq('is_active', true);

            // 4. Add or update new device (upsert to handle case where device already exists)
            const { error: upsertError } = await supabase
                .from('devices')
                .upsert({
                    user_id: request.user_id,
                    device_id: request.new_device_id,
                    device_model: request.new_device_model || 'Unknown',
                    os_type: request.new_os_type || 'Unknown',
                    browser_info: request.new_browser_info || 'Unknown',
                    is_active: true,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'user_id,device_id'
                });

            if (upsertError) {
                console.error('Device upsert error:', upsertError);
                return res.status(200).json({ success: false, message: "فشل إضافة/تحديث الجهاز الجديد: " + upsertError.message });
            }

            // 5. Update request status
            const { error: updateError } = await supabase
                .from('device_change_requests')
                .update({
                    status: 'approved',
                    processed_at: new Date().toISOString(),
                    processed_by: adminId || adminName || 'admin'
                })
                .eq('id', requestId);

            if (updateError) {
                return res.status(200).json({ success: false, message: "فشل تحديث حالة الطلب" });
            }

            return res.status(200).json({
                success: true,
                message: `تم الموافقة على طلب تغيير الجهاز بنجاح. الجهاز الجديد مسجل للموظف.`
            });
        }

        // --- REJECT DEVICE CHANGE REQUEST (Admin) ---
        if (action === "rejectDeviceChangeRequest") {
            const { requestId, adminNote, adminId, adminName } = data;

            const { data: request, error: reqError } = await supabase
                .from('device_change_requests')
                .select('*')
                .eq('id', requestId)
                .single();

            if (reqError || !request) {
                return res.status(200).json({ success: false, message: "الطلب غير موجود" });
            }

            if (request.status !== 'pending') {
                return res.status(200).json({ success: false, message: "تمت معالجة هذا الطلب مسبقاً" });
            }

            const { error } = await supabase
                .from('device_change_requests')
                .update({
                    status: 'rejected',
                    admin_note: adminNote || '',
                    processed_at: new Date().toISOString(),
                    processed_by: adminId || adminName || 'admin'
                })
                .eq('id', requestId);

            if (error) {
                return res.status(200).json({ success: false, message: "فشل رفض الطلب" });
            }

            return res.status(200).json({ success: true, message: "تم رفض طلب تغيير الجهاز بنجاح" });
        }

        // --- CLEAR PROCESSED DEVICE REQUESTS (Admin) ---
        if (action === "clearProcessedDeviceRequests") {
            const { error } = await supabase
                .from('device_change_requests')
                .delete()
                .in('status', ['approved', 'rejected']);

            if (error) {
                console.error("Clear processed device requests error:", error);
                return res.status(200).json({ success: false, message: "فشل مسح الطلبات المنتهية" });
            }

            return res.status(200).json({
                success: true,
                message: "تم مسح جميع طلبات تغيير الأجهزة المنتهية بنجاح"
            });
        }

        // --- GET ALL DEVICES (Admin) ---
        if (action === "getAllDevices") {
            const { data: devices, error } = await supabase
                .from('devices')
                .select(`
                    *,
                    employees:user_id (name, email, phone)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Format the data to include user info
            const formattedDevices = (devices || []).map(d => ({
                ...d,
                userName: d.employees?.name || 'Unknown',
                userEmail: d.employees?.email || '',
                userPhone: d.employees?.phone || ''
            }));

            return res.status(200).json({ success: true, data: formattedDevices });
        }

        // --- DELETE DEVICE (Admin) ---
        if (action === "deleteDevice") {
            const { deviceId, userId, deviceIdString } = data;

            if (!deviceId || !userId) {
                return res.status(200).json({ success: false, message: "بيانات غير مكتملة" });
            }

            // Use deviceIdString (the actual device fingerprint) for attendance deletion
            const actualDeviceId = deviceIdString || deviceId;

            // 1. Delete all attendance records linked to this device
            const { data: deletedAttendance, error: attError } = await supabase
                .from('attendance')
                .delete()
                .eq('device_id', actualDeviceId)
                .eq('employeeId', userId)
                .select();

            if (attError) {
                console.error('Error deleting attendance:', attError);
            }

            // 2. Delete the device (using UUID)
            const { error: deviceError } = await supabase
                .from('devices')
                .delete()
                .eq('id', deviceId)
                .eq('user_id', userId);

            if (deviceError) {
                return res.status(200).json({ success: false, message: "فشل حذف الجهاز" });
            }

            const attendanceCount = deletedAttendance ? deletedAttendance.length : 0;
            return res.status(200).json({
                success: true,
                message: `تم حذف الجهاز بنجاح${attendanceCount > 0 ? ` و ${attendanceCount} سجل حضور مرتبط` : ''}`
            });
        }

        // --- GET USER DEVICE INFO (Employee/Admin) ---
        if (action === "getUserDevice") {
            const { userId } = data;

            if (!userId) {
                return res.status(200).json({ success: false, message: "معرف المستخدم مطلوب" });
            }

            const { data: devices, error } = await supabase
                .from('devices')
                .select('*')
                .eq('user_id', userId)
                .eq('is_active', true);

            if (error) throw error;

            return res.status(200).json({
                success: true,
                data: devices || [],
                hasDevice: devices && devices.length > 0
            });
        }

        // --- UTILS ---
        if (action === "resolveMapLink") {
            const link = data.link;
            try {
                const resLink = await fetch(link, { method: 'HEAD', redirect: 'follow' });
                return res.status(200).json({ success: true, url: resLink.url });
            } catch (e) {
                return res.status(200).json({ success: false, message: e.message });
            }
        }

        // --- REPORT SENDING VIA GMAILAPP ---
        if (action === "sendAttendanceReport") {
            // Proxy to Google Script for GmailApp email with Excel attachment
            const reportRes = await fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'sendAttendanceReport',
                    startDate: data.startDate,
                    endDate: data.endDate,
                    email: data.email // optional - if not provided, uses settings.reportEmails
                }),
                headers: { 'Content-Type': 'text/plain' }
            });
            const reportResult = await reportRes.json();
            return res.status(200).json(reportResult);
        }

        if (action === "sendEmployeeReport") {
            // Proxy to Google Script for GmailApp email with Excel attachment
            const reportRes = await fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'sendEmployeeDetailedReport',
                    employeeId: data.employeeId,
                    employeeName: data.employeeName,
                    startDate: data.startDate,
                    endDate: data.endDate,
                    email: data.email // optional
                }),
                headers: { 'Content-Type': 'text/plain' }
            });
            const reportResult = await reportRes.json();
            return res.status(200).json(reportResult);
        }

        // --- FINAL FALLBACK ---
        const proxyRes = await fetch(GOOGLE_SCRIPT_URL, {
            method: req.method === 'POST' ? 'POST' : 'GET',
            body: req.method === 'POST' ? JSON.stringify(data) : undefined,
            headers: { 'Content-Type': 'text/plain' }
        });
        const proxyJson = await proxyRes.json();
        return res.status(200).json(proxyJson);

    } catch (e) {
        console.error("Handler Error:", e);
        // Supabase error objects can be complex, ensure we extract the meaningful message
        const errorMsg = e.message || (e.error && e.error.message) || e.toString();
        return res.status(200).json({ success: false, message: errorMsg });
    }
}
