import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';

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

// --- EMAIL APPROVAL HELPERS ---

async function createActionTokens(requestType, requestId) {
    const approveToken = crypto.randomUUID();
    const rejectToken = crypto.randomUUID();

    const tokens = [
        {
            token: approveToken,
            requestType,
            requestId,
            action: 'approve'
        },
        {
            token: rejectToken,
            requestType,
            requestId,
            action: 'reject'
        }
    ];

    const { error } = await supabase.from('action_tokens').insert(tokens);
    if (error) throw error;

    return { approveToken, rejectToken };
}

function renderResponsePage(type, message) {
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b'
    };
    const titles = {
        success: 'تمت العملية بنجاح',
        error: 'حدث خطأ',
        warning: 'تنبيه'
    };
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️'
    };

    return `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${titles[type]}</title>
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Tajawal', sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: white; padding: 2.5rem; border-radius: 1.5rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
            .icon { font-size: 4rem; margin-bottom: 1.5rem; }
            h1 { color: #1e293b; margin-bottom: 1rem; font-size: 1.5rem; }
            p { color: #64748b; font-size: 1.1rem; line-height: 1.6; margin-bottom: 2rem; }
            .btn { display: inline-block; padding: 0.8rem 2rem; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: white; text-decoration: none; border-radius: 0.8rem; font-weight: bold; transition: opacity 0.2s; }
            .btn:hover { opacity: 0.9; }
        </style>
    </head>
    <body>
        <div class="card">
            <div class="icon" style="color: ${colors[type]}">${icons[type]}</div>
            <h1>${titles[type]}</h1>
            <p>${message}</p>
            <a href="#" class="btn" onclick="window.close(); return false;">إغلاق هذه النافذة</a>
        </div>
    </body>
    </html>
    `;
}

function renderConfirmPage(token, requestType, userAction, details) {
    const actionText = userAction === 'approve' ? 'موافقة' : 'رفض';
    const actionColor = userAction === 'approve' ? '#10b981' : '#ef4444';
    const requestTypeText = {
        'allowance': 'طلب زيادة بدلات',
        'leave': 'طلب إجازة',
        'site': 'طلب تسجيل موقع',
        'device_change': 'طلب تغيير جهاز'
    }[requestType] || 'طلب جديد';

    return `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>تأكيد الإجراء</title>
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Tajawal', sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
            .card { background: white; padding: 2.5rem; border-radius: 1.5rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); text-align: center; max-width: 450px; width: 90%; }
            h1 { color: #1e293b; margin-bottom: 1.5rem; font-size: 1.5rem; }
            p { color: #64748b; font-size: 1.1rem; line-height: 1.6; margin-bottom: 2rem; }
            .details { background: #f1f5f9; padding: 1rem; border-radius: 1rem; margin-bottom: 2rem; text-align: right; }
            .details-row { display: flex; justify-content: space-between; margin-bottom: 0.5rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; }
            .btn { display: block; padding: 1rem; color: white; text-decoration: none; border-radius: 0.8rem; font-weight: bold; transition: opacity 0.2s; font-size: 1.2rem; }
            .btn:hover { opacity: 0.9; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>تأكيد الإجراء</h1>
            <p>هل أنت متأكد من رغبتك في <strong>${actionText}</strong> على هذا الطلب؟</p>
            
            <div class="details">
                <div class="details-row"><span>نوع الطلب:</span><strong>${requestTypeText}</strong></div>
                ${Object.entries(details).map(([key, value]) => {
                    if (!value || key === 'employeeName') return '';
                    const labels = {
                        'amount': 'المبلغ',
                        'date': 'التاريخ',
                        'reason': 'السبب',
                        'site': 'الموقع المقترح',
                        'device': 'الجهاز الجديد'
                    };
                    return `<div class="details-row"><span>${labels[key] || key}:</span><strong>${value}</strong></div>`;
                }).join('')}
                <div class="details-row"><span>الموظف:</span><strong>${details.employeeName || 'غير معروف'}</strong></div>
            </div>

            <a href="/api/exec?action=handleEmailAction&token=${token}&confirm=true" class="btn" style="background: ${actionColor}">تأكيد ال${actionText}</a>
            <p style="margin-top: 1.5rem; font-size: 0.9rem;">هذه الخطوة الإضافية لمنع تفعيل الروابط تلقائياً من برامج الحماية.</p>
        </div>
    </body>
    </html>
    `;
}

async function triggerHRApprovalEmail(req, requestType, requestDetails) {
    try {
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers.host;
        const baseUrl = `${protocol}://${host}`;

        const { approveToken, rejectToken } = await createActionTokens(requestType, requestDetails.id);
        
        const approveLink = `${baseUrl}/api/exec?action=handleEmailAction&token=${approveToken}`;
        const rejectLink = `${baseUrl}/api/exec?action=handleEmailAction&token=${rejectToken}`;

        await syncToGoogleSheet({
            action: 'sendHRApprovalEmail',
            requestType,
            requestDetails,
            approveLink,
            rejectLink
        });
    } catch (e) {
        console.error("Failed to trigger HR email:", e);
    }
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
async function createDeviceChangeRequest(supabase, userId, userName, oldDeviceId, newDeviceInfo, reason) {
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
        
        const requestId = crypto.randomUUID();
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
        
        return { success: true, message: 'تم إرسال طلب تغيير الجهاز بنجاح', requestId: requestId };
    } catch (error) {
        console.error('Create device change request exception:', error);
        return { success: false, message: 'حدث خطأ أثناء إنشاء الطلب' };
    }
}

// Helper: Distance calculation in meters
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const f1 = lat1 * Math.PI/180;
  const f2 = lat2 * Math.PI/180;
  const df = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(df/2)**2 + Math.cos(f1)*Math.cos(f2) * Math.sin(dl/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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
        await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'text/plain' }
        });
    } catch (e) {
        console.error("Google Sync Failed:", e);
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

        // --- NEW: EMAIL ACTIONS (PUBLIC) ---
        if (action === "handleEmailAction") {
            const { token } = data;
            if (!token) return res.status(400).send('Missing token');

            // 1. Verify token
            const { data: tokenData, error: tokenError } = await supabase
                .from('action_tokens')
                .select('*')
                .eq('token', token)
                .single();

            if (tokenError || !tokenData) {
                return res.status(404).send(renderResponsePage('error', 'الرابط غير صالح أو منتهي الصلاحية.'));
            }

            if (tokenData.usedAt) {
                return res.status(200).send(renderResponsePage('success', 'تمت معالجة هذا الطلب بنجاح مسبقاً ✅'));
            }

            if (new Date() > new Date(tokenData.expiresAt)) {
                return res.status(400).send(renderResponsePage('error', 'عفواً، صلاحية هذا الرابط انتهت.'));
            }

            const { requestType, requestId, action: userAction } = tokenData;
            const { confirm } = data;

            // NEW: Landing page to prevent bot pre-fetching
            if (confirm !== 'true') {
                // Fetch full details for the confirm page
                let details = { employeeName: '...' };
                try {
                    if (requestType === 'allowance') {
                        const { data: d } = await supabase.from('allowanceRequests').select('employeeName, amount, requestDate').eq('id', requestId).single();
                        if (d) details = { employeeName: d.employeeName, amount: d.amount + ' ج.م', date: d.requestDate };
                    } else if (requestType === 'leave') {
                        const { data: d } = await supabase.from('leaveRequests').select('employeeName, leaveDate, reason').eq('id', requestId).single();
                        if (d) details = { employeeName: d.employeeName, date: d.leaveDate, reason: d.reason };
                    } else if (requestType === 'site') {
                        const { data: d } = await supabase.from('siteRequests').select('employeeName, suggestedName').eq('id', requestId).single();
                        if (d) details = { employeeName: d.employeeName, site: d.suggestedName };
                    } else if (requestType === 'device_change') {
                        const { data: d } = await supabase.from('device_change_requests').select('user_name, newDeviceModel').eq('id', requestId).single();
                        if (d) details = { employeeName: d.user_name, device: d.newDeviceModel };
                    }
                } catch(e) { console.error("Confirm Page Fetch Error:", e); }
                
                return res.status(200).send(renderConfirmPage(token, requestType, userAction, details));
            }

            // 2. Perform action
            let responseMessage = '';

            try {
                if (requestType === 'allowance') {
                    // Fetch request data
                    const { data: reqData, error: reqError } = await supabase
                        .from('allowanceRequests')
                        .select('*')
                        .eq('id', requestId)
                        .single();

                    if (reqError || !reqData) throw new Error('الطلب غير موجود');
                    if (reqData.status !== 'pending') {
                        return res.status(200).send(renderResponsePage('success', 'تمت معالجة هذا الطلب بنجاح مسبقاً ✅'));
                    }

                    if (userAction === 'approve') {
                        // Approve logic
                        const { data: attData } = await supabase
                            .from('attendance')
                            .select('transportPrice')
                            .eq('id', reqData.attendanceId)
                            .single();
                        
                        if (attData) {
                            const newPrice = parseFloat(attData.transportPrice || 0) + parseFloat(reqData.amount);
                            await supabase.from('attendance').update({ transportPrice: newPrice }).eq('id', reqData.attendanceId);
                        }

                        const { error: updErr } = await supabase.from('allowanceRequests').update({
                            status: 'approved',
                            approvedAt: getCairoISOString(),
                            approvedBy: 'Email Action'
                        }).eq('id', requestId);
                        if (updErr) throw updErr;

                        // Add Log
                        await supabase.from('approvalLogs').insert([{
                            id: "LOG" + Math.floor(10000 + Math.random() * 90000),
                            requestId: requestId,
                            adminName: 'Email Action',
                            action: 'approved',
                            details: 'تمت الموافقة عبر البريد الإلكتروني',
                            timestamp: getCairoISOString()
                        }]);
                        
                        // Mark internal notifications as read
                        await supabase.from('notifications').update({ isRead: true }).eq('relatedId', requestId);
                        
                        // Notify employee
                        await supabase.from('notifications').insert([{
                            id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                            userId: reqData.employeeId,
                            title: 'تمت الموافقة على طلبك',
                            message: `تمت الموافقة على طلب زيادة البدلات بمبلغ ${reqData.amount} ج.م`,
                            type: 'allowance_approved',
                            relatedId: requestId,
                            isRead: false,
                            createdAt: getCairoISOString()
                        }]);

                        responseMessage = 'تمت الموافقة على طلب البدلات وتحديثها بنجاح ✅';
                    } else {
                        // Reject logic
                        const { error: updErr } = await supabase.from('allowanceRequests').update({
                            status: 'rejected'
                        }).eq('id', requestId);
                        if (updErr) throw updErr;

                        // Add Log
                        await supabase.from('approvalLogs').insert([{
                            id: "LOG" + Math.floor(10000 + Math.random() * 90000),
                            requestId: requestId,
                            adminName: 'Email Action',
                            action: 'rejected',
                            details: 'تم الرفض عبر البريد الإلكتروني',
                            timestamp: getCairoISOString()
                        }]);

                        await supabase.from('notifications').update({ isRead: true }).eq('relatedId', requestId);

                        await supabase.from('notifications').insert([{
                            id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                            userId: reqData.employeeId,
                            title: 'تم رفض طلبك',
                            message: `تم رفض طلب زيادة البدلات بمبلغ ${reqData.amount} ج.م`,
                            type: 'allowance_rejected',
                            relatedId: requestId,
                            isRead: false,
                            createdAt: getCairoISOString()
                        }]);
                        
                        responseMessage = 'تم رفض طلب البدلات ❌';
                    }
                } else if (requestType === 'leave') {
                    // Fetch request data
                    const { data: reqData, error: reqError } = await supabase
                        .from('leaveRequests')
                        .select('*')
                        .eq('id', requestId)
                        .single();

                    if (reqError || !reqData) throw new Error('الطلب غير موجود');
                    if (reqData.status !== 'pending') {
                        return res.status(200).send(renderResponsePage('success', 'تمت معالجة هذا الطلب بنجاح مسبقاً ✅'));
                    }

                    if (userAction === 'approve') {
                        const { error: updErr } = await supabase.from('leaveRequests').update({
                            status: 'approved',
                            approvedAt: getCairoISOString(),
                            approvedBy: 'Email Action'
                        }).eq('id', requestId);
                        if (updErr) throw updErr;
                        
                        // Verify the update was successful and status is still approved
                        const { data: verifyData } = await supabase.from('leaveRequests')
                            .select('status')
                            .eq('id', requestId)
                            .single();
                        
                        if (!verifyData || verifyData.status !== 'approved') {
                            return res.status(200).send(renderResponsePage('success', 'تمت معالجة هذا الطلب بنجاح مسبقاً ✅'));
                        }
                        
                        await supabase.from('notifications').update({ isRead: true }).eq('relatedId', requestId);
                        
                        await supabase.from('notifications').insert([{
                            id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                            userId: reqData.employeeId,
                            title: 'تمت الموافقة على إجازتك',
                            message: `تمت الموافقة على طلب إجازتك بتاريخ ${reqData.leaveDate}`,
                            type: 'leave_approved',
                            relatedId: requestId,
                            isRead: false,
                            createdAt: getCairoISOString()
                        }]);

                        responseMessage = 'تمت الموافقة على طلب الإجازة بنجاح ✅';
                    } else {
                        const { error: updErr } = await supabase.from('leaveRequests').update({
                            status: 'rejected',
                            rejectionReason: 'تم الرفض عبر البريد الإلكتروني'
                        }).eq('id', requestId);
                        if (updErr) throw updErr;

                        // Verify the update was successful and status is still rejected
                        const { data: verifyData } = await supabase.from('leaveRequests')
                            .select('status')
                            .eq('id', requestId)
                            .single();
                        
                        if (!verifyData || verifyData.status !== 'rejected') {
                            return res.status(200).send(renderResponsePage('success', 'تمت معالجة هذا الطلب بنجاح مسبقاً ✅'));
                        }

                        await supabase.from('notifications').update({ isRead: true }).eq('relatedId', requestId);

                        await supabase.from('notifications').insert([{
                            id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                            userId: reqData.employeeId,
                            title: 'تم رفض طلب الإجازة',
                            message: `تم رفض طلب إجازتك بتاريخ ${reqData.leaveDate}`,
                            type: 'leave_rejected',
                            relatedId: requestId,
                            isRead: false,
                            createdAt: getCairoISOString()
                        }]);
                        
                        responseMessage = 'تم رفض طلب الإجازة ❌';
                    }
                } else if (requestType === 'site') {
                    // Fetch request data
                    const { data: reqData, error: reqError } = await supabase
                        .from('siteRequests')
                        .select('*')
                        .eq('id', requestId)
                        .single();

                    if (reqError || !reqData) throw new Error('الطلب غير موجود');
                    if (reqData.status !== 'pending') throw new Error('لقد تمت معالجة هذا الطلب بالفعل.');

                    if (userAction === 'approve') {
                        // Approve for today only by default from email
                        const { error: updErr } = await supabase.from('siteRequests').update({
                            status: 'approved_today',
                            approvedAt: getCairoISOString(),
                            tempRadius: 100,
                            transportPrice: 120
                        }).eq('id', requestId);
                        if (updErr) throw updErr;
                        
                        await supabase.from('notifications').update({ isRead: true }).eq('relatedId', requestId);
                        
                        await supabase.from('notifications').insert([{
                            id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                            userId: reqData.employeeId,
                            title: 'تمت الموافقة على موقعك',
                            message: `تمت الموافقة على طلب تسجيل الموقع: ${reqData.suggestedName} (لليوم فقط)`,
                            type: 'site_approved',
                            relatedId: requestId,
                            isRead: false,
                            createdAt: getCairoISOString()
                        }]);

                        responseMessage = 'تمت الموافقة على الموقع (لليوم فقط) بنجاح ✅';
                    } else {
                        await supabase.from('siteRequests').update({
                            status: 'rejected'
                        }).eq('id', requestId);

                        await supabase.from('notifications').update({ isRead: true }).eq('relatedId', requestId);

                        await supabase.from('notifications').insert([{
                            id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                            userId: reqData.employeeId,
                            title: 'تم رفض طلب الموقع',
                            message: `تم رفض طلب تسجيل الموقع: ${reqData.suggestedName}`,
                            type: 'site_rejected',
                            relatedId: requestId,
                            isRead: false,
                            createdAt: getCairoISOString()
                        }]);
                        
                        responseMessage = 'تم رفض طلب الموقع ❌';
                    }
                } else if (requestType === 'device_change') {
                    const { data: reqData, error: errFetch } = await supabase.from('device_change_requests').select('*').eq('id', requestId).single();
                    if (errFetch || !reqData) throw new Error("طلب تغيير الجهاز غير موجود");
                    if (reqData.status !== 'pending') {
                        return res.status(200).send(renderResponsePage('success', 'تمت معالجة هذا الطلب بنجاح مسبقاً ✅'));
                    }

                    if (userAction === 'approve') {
                        // Logic copied from approveDeviceChangeRequest handler
                        if (reqData.old_device_id) {
                            await supabase.from('devices').update({ is_active: false, updated_at: getCairoISOString() })
                                .eq('user_id', reqData.user_id).eq('device_id', reqData.old_device_id);
                        }
                        await supabase.from('devices').update({ is_active: false, updated_at: getCairoISOString() })
                            .eq('user_id', reqData.user_id).eq('is_active', true);
                        
                        await supabase.from('devices').upsert({
                            user_id: reqData.user_id,
                            device_id: reqData.new_device_id,
                            device_model: reqData.new_device_model || 'Unknown',
                            os_type: reqData.new_os_type || 'Unknown',
                            browser_info: reqData.new_browser_info || 'Unknown',
                            is_active: true,
                            updated_at: getCairoISOString()
                        }, { onConflict: 'user_id,device_id' });

                        await supabase.from('device_change_requests').update({
                            status: 'approved',
                            processed_at: getCairoISOString(),
                            processed_by: 'email_approval'
                        }).eq('id', requestId);

                        responseMessage = 'تمت الموافقة على تغيير الجهاز بنجاح ✅';
                    } else {
                        await supabase.from('device_change_requests').update({
                            status: 'rejected',
                            processed_at: getCairoISOString(),
                            processed_by: 'email_approval'
                        }).eq('id', requestId);

                        responseMessage = 'تم رفض طلب تغيير الجهاز ❌';
                    }
                }
                
                // 3. Delete token to clean up database
                await supabase.from('action_tokens').delete().eq('token', token);
                
                return res.status(200).send(renderResponsePage('success', responseMessage));
            } catch (err) {
                return res.status(500).send(renderResponsePage('error', err.message));
            }
        }

        // DUAL WRITING / BACKUP SYNC:
        // For writing actions, we asynchronously broadcast the exact request to your existing Google Apps Script
        // Note: addAttendance and checkoutAttendance sync explicitly after successful DB insert with server timestamps
        const writeActions = [
            "saveEmployee", "updateEmployee", "deleteEmployee",
            "saveSite", "updateSite", "deleteSite",
            "addSiteRequest", "approveSiteRequest", "rejectSiteRequest",
            "updateSettings",
            "addAllowanceRequest", "handleAllowanceRequest",
            "addLeaveRequest", "approveLeaveRequest", "rejectLeaveRequest",
            "markNotificationAsRead", "markAllNotificationsAsRead",
            "addOfficialHoliday", "deleteOfficialHoliday"
        ];
        if (writeActions.includes(action)) {
            syncToGoogleSheet(data);
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
             if (role && normalizeString(user.role).toLowerCase() !== role) {
                 throw new Error("لا تملك صلاحية الدخول");
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

        // --- DASHBOARD DATA (GET) ---
        if (action === "getDashboardData") {
            const [empRes, siteRes, attRes, reqRes, setRes, allRes, leaveRes, allowRes] = await Promise.all([
                supabase.from('employees').select('*'),
                supabase.from('sites').select('*'),
                supabase.from('attendance').select('*'),
                supabase.from('siteRequests').select('*'),
                supabase.from('settings').select('*'),
                supabase.from('siteAllowances').select('*'),
                supabase.from('leaveRequests').select('*'),
                supabase.from('allowanceRequests').select('*')
            ]);
            let settings = {};
            if (setRes.data) {
                setRes.data.forEach(s => settings[s.key] = s.value);
            }

            // Map allowances to employees
            const employees = (empRes.data || []).map(emp => ({
                ...emp,
                assignedSites: emp.assignedSites ? String(emp.assignedSites).split(',').map(s => s.trim()).filter(Boolean) : [],
                siteAllowances: (allRes.data || []).filter(a => String(a.employeeId) === String(emp.id))
            }));

            // --- HOTFIX: Correct today's attendance status if it's a holiday ---
            try {
                const todayStr = getCairoDateString(new Date());
                const { data: holidayToday } = await supabase.from('official_holidays').select('*').eq('holidayDate', todayStr).maybeSingle();
                if (holidayToday) {
                    // Today is a holiday! Update any 'present' or 'late' records for today to 'overtime'
                    await supabase.from('attendance')
                        .update({ status: 'overtime' })
                        .in('status', ['present', 'late'])
                        .filter('checkIn', 'gte', todayStr + 'T00:00:00');
                    
                    // Refresh attendance data for the response if needed (optional since frontend will reload)
                    const { data: refreshedAtt } = await supabase.from('attendance').select('*');
                    if (refreshedAtt) attRes.data = refreshedAtt;
                }
            } catch (hotfixErr) {
                console.error("Hotfix failed:", hotfixErr);
            }

            return res.status(200).json({
                success: true,
                employees: employees,
                sites: siteRes.data || [],
                attendance: attRes.data || [],
                siteRequests: reqRes.data || [],
                settings: settings,
                siteAllowances: allRes.data || [],
                leaveRequests: leaveRes.data || [],
                allowanceRequests: allowRes.data || []
            });
        }

        // --- EMPLOYEE DASHBOARD INIT ---
        if (action === "getPortalInitialData") {
            const empId = data.employeeId;
            const [siteRes, attRes] = await Promise.all([
                supabase.from('sites').select('*'),
                supabase.from('attendance').select('*').eq('employeeId', empId).order('checkIn', { ascending: true })
            ]);
            return res.status(200).json({ success: true, sites: siteRes.data || [], attendance: attRes.data || [] });
        }

        if (action === "getAttendance") {
            let query = supabase.from('attendance').select('*').order('checkIn', { ascending: true });
            if (data.employeeId) query = query.eq('employeeId', data.employeeId);
            const { data: att, error } = await query;
            if (error) throw error;
            return res.status(200).json({ success: true, data: att });
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

            if (sites) {
                for (let s of sites) {
                    let d = getDistance(data.latitude, data.longitude, s.latitude, s.longitude);
                    if (d <= s.radius) { matchedSite = s; break; }
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
            invalidateCache('sites');
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
            invalidateCache('sites');
            return res.status(200).json({ success: true, message: "تم تحديث بيانات الموقع بنجاح" });
        }

        if (action === "deleteSite") {
            const { error } = await supabase.from('sites').delete().eq('id', data.id);
            if (error) throw error;
            invalidateCache('sites');
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

            if (mapLink) {
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

            const payload = {
                id: data.id || crypto.randomUUID(),
                employeeId: data.employeeId,
                employeeName: data.employeeName,
                suggestedName: data.suggestedName,
                latitude: data.latitude,
                longitude: data.longitude,
                mapLink: mapLink,
                mapLatitude: mapLatitude,
                mapLongitude: mapLongitude,
                transportPrice: data.transportPrice || 120,
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
            
            // 🚀 TRIGGER EMAIL APPROVAL
            await triggerHRApprovalEmail(req, 'site', payload);

            return res.status(200).json({ 
                success: true, 
                message: "تم إرسال طلب الموقع بنجاح. سيتم تفعيل الموافقة التلقائية خلال دقيقتين إذا كنت في الموقع." 
            });
        }

        if (action === "approveSiteRequest") {
            const { id, name, transportPrice, radius, mode, mapLink } = data;
            
            // 1. Update Request table
            const { data: reqData, error: errFetch } = await supabase.from('siteRequests').select('*').eq('id', id).single();
            if (errFetch || !reqData) throw new Error("الطلب غير موجود");

            const finalStatus = (mode === 'daily' || mode === 'today') ? 'approved_today' : 'approved';
            const { error: errReq } = await supabase.from('siteRequests')
                .update({ 
                    status: finalStatus,
                    approvedAt: new Date().toISOString(),
                    transportPrice: transportPrice || reqData.transportPrice,
                    tempRadius: radius || reqData.tempRadius
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
                transportPrice: transportPrice || 120,
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
                message: `تمت الموافقة على طلب تسجيل الموقع: ${name || reqData.suggestedName} ${approvalType}`,
                type: 'site_approved',
                relatedId: id,
                isRead: false,
                createdAt: new Date().toISOString()
            }]);
            
            return res.status(200).json({ success: true, message: "تمت الموافقة على الطلب بنجاح" });
        }

        if (action === "rejectSiteRequest") {
            // Get request data first for notification
            const { data: reqData } = await supabase.from('siteRequests').select('*').eq('id', data.id).single();
            
            const { error } = await supabase.from('siteRequests').update({ status: 'rejected' }).eq('id', data.id);
            if (error) throw error;
            
            // Notify employee
            if (reqData) {
                await supabase.from('notifications').insert([{
                    id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                    userId: reqData.employeeId,
                    title: 'تم رفض طلب موقعك',
                    message: `تم رفض طلب تسجيل الموقع: ${reqData.suggestedName}`,
                    type: 'site_rejected',
                    relatedId: data.id,
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
            const requestId = crypto.randomUUID();
            const payload = {
                id: requestId,
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
                relatedId: requestId,
                isRead: false,
                createdAt: new Date().toISOString()
            }]);
            
            // 🚀 TRIGGER EMAIL APPROVAL
            await triggerHRApprovalEmail(req, 'allowance', payload);

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
                    status: status
                })
                .eq('id', requestId);
            
            if (errUpdReq) throw errUpdReq;

            // 5. Add Log
            await supabase.from('approvalLogs').insert([{
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
                ? `تمت الموافقة على طلب زيادة البدلات بمبلغ ${reqData.amount} ج.م`
                : `تم رفض طلب زيادة البدلات بمبلغ ${reqData.amount} ج.م${adminNote ? `. السبب: ${adminNote}` : ''}`;
            
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

        // --- LEAVE REQUESTS ---
        if (action === "addLeaveRequest") {
            const requestId = crypto.randomUUID();
            const { employeeId, employeeName, leaveDate, reason } = data;
            
            if (!leaveDate) return res.status(200).json({ success: false, message: "تاريخ الإجازة مطلوب" });
            if (!reason) return res.status(200).json({ success: false, message: "سبب الإجازة مطلوب" });
            
            // Check for duplicate pending/approved request for this date
            const { data: existing, error: checkErr } = await supabase
                .from('leaveRequests')
                .select('*')
                .eq('employeeId', employeeId)
                .eq('leaveDate', leaveDate)
                .in('status', ['pending', 'approved'])
                .single();
            
            if (checkErr && checkErr.code !== 'PGRST116') { // Not found is ok
                throw checkErr;
            }
            
            if (existing) {
                return res.status(200).json({ success: false, message: "لديك طلب إجازة موجود بالفعل لهذا التاريخ" });
            }
            
            const payload = {
                id: requestId,
                employeeId,
                employeeName,
                leaveDate,
                reason,
                status: 'pending',
                createdAt: new Date().toISOString()
            };
            
            const { error } = await supabase.from('leaveRequests').insert([payload]);
            if (error) throw error;
            
            // Create notification for HR
            await supabase.from('notifications').insert([{
                id: "NOTIF" + Math.floor(10000 + Math.random() * 90000),
                userRole: 'hr',
                title: 'طلب إجازة جديد',
                message: `قام الموظف ${employeeName} بطلب إجازة بتاريخ ${leaveDate}`,
                type: 'leave_request',
                relatedId: requestId,
                isRead: false,
                createdAt: new Date().toISOString()
            }]);
            
            // 🚀 TRIGGER EMAIL APPROVAL
            await triggerHRApprovalEmail(req, 'leave', payload);

            return res.status(200).json({ success: true, message: "تم إرسال طلب الإجازة بنجاح للمراجعة" });
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
            const { data: holidays, error } = await supabase.from('official_holidays').select('*').order('holidayDate', { ascending: true });
            if (error) throw error;
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
            
            // Sync to Google Sheets so Code.gs can see the new emails immediately
            await syncToGoogleSheet(data);
            
            invalidateCache('settings');
            return res.status(200).json({ success: true, message: "تم تحديث الإعدادات بنجاح ومزامنتها" });
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
                reason
            );

            if (result.success && result.requestId) {
                // 🚀 TRIGGER EMAIL APPROVAL
                await triggerHRApprovalEmail(req, 'device_change', {
                    id: result.requestId,
                    employeeId,
                    employeeName,
                    oldDeviceId: currentDeviceId,
                    newDeviceModel: newDeviceInfo.deviceModel,
                    reason
                });
            }
            
            return res.status(200).json(result);
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
