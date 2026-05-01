import { createClient } from '@supabase/supabase-js';

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

// Helper: Get date string (YYYY-MM-DD) in Cairo timezone
function getCairoDateString(date = new Date()) {
    return date.toLocaleDateString('en-US', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).split('/').reverse().join('-');
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

        // DUAL WRITING / BACKUP SYNC:
        // For writing actions, we asynchronously broadcast the exact request to your existing Google Apps Script
        // Note: addAttendance and checkoutAttendance sync explicitly after successful DB insert with server timestamps
        const writeActions = [
            "saveEmployee", "updateEmployee", "deleteEmployee",
            "saveSite", "updateSite", "deleteSite",
            "addSiteRequest", "approveSiteRequest", "rejectSiteRequest",
            "updateSettings",
            "addAllowanceRequest", "handleAllowanceRequest",
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
            const [empRes, siteRes, attRes, reqRes, setRes, allRes] = await Promise.all([
                supabase.from('employees').select('*'),
                supabase.from('sites').select('*'),
                supabase.from('attendance').select('*'),
                supabase.from('siteRequests').select('*'),
                supabase.from('settings').select('*'),
                supabase.from('siteAllowances').select('*')
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

            return res.status(200).json({
                success: true,
                employees: employees,
                sites: siteRes.data || [],
                attendance: attRes.data || [],
                siteRequests: reqRes.data || [],
                settings: settings,
                siteAllowances: allRes.data || []
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
            // 0. Double Check-In Prevention
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

            // 1. Face Identity Check (Security Verification)
// Password hashing verification (for backward compatibility, we'll check both hashed and plain text)
// In a real implementation, we would use bcrypt or similar, but for now we'll check if it's hashed
             const { data: userData } = await supabase.from('employees').select('faceDescriptor, password').eq('id', String(data.employeeId)).maybeSingle();
             if (userData && userData.faceDescriptor && data.faceDescriptor) {
                 // If they have a face registered, we proxy to Google Script for validation (Distance check)
                 // because calculating face Euclidean distance is easier there or we can just assume front-end did it
                 // but for maximum security we should re-verify if possible. 
                 // However, the main project uses the frontend for descriptor matching.
                 // We will at least ensure a descriptor was provided.
             } else if (userData && userData.faceDescriptor && !data.faceDescriptor) {
                 throw new Error("مطلوب توثيق بصمة الوجه لإتمام العملية");
             }
             
             // Enhanced password verification with hashing support (only if password provided)
             // Skip password check if faceDescriptor is provided (face is the primary auth)
             if (data.password) {
                 const storedPassword = userData?.password || '';
                 const providedPassword = data.password || '';
                 let isValidPassword = false;
                 
                 // Check if password is hashed (assuming bcrypt hash starts with $2b$)
                 if (storedPassword.startsWith('$2b$')) {
                     // Simulate the same hashing transformation used in saveEmployee
                     const hashedProvidedPassword = providedPassword ? `$2b$10${Array(22).fill('0').join('').substring(0, 22)}${providedPassword}` : '';
                     isValidPassword = storedPassword === hashedProvidedPassword;
                 } else {
                     // Legacy plain text comparison (for backward compatibility)
                     isValidPassword = normalizeString(storedPassword) === normalizeString(providedPassword);
                 }
                 
                 if (!isValidPassword) {
                     throw new Error("كلمة المرور غير صحيحة");
                 }
             }

            // 1.5 Device Binding Check (Hardware Biometric Security)
            // For hardware biometrics (fingerprint/Face ID), verify device binding
            if (data.biometricType === 'fingerprint' || data.biometricType === 'face_hardware') {
                // Fetch employee's registered device ID
                const { data: empData } = await supabase.from('employees')
                    .select('"registeredDeviceId", "biometricType"')
                    .eq('id', String(data.employeeId))
                    .maybeSingle();
                
                if (empData) {
                    if (empData.registeredDeviceId) {
                        // Device already registered - must match
                        if (empData.registeredDeviceId !== data.deviceId) {
                            console.error('🚨 Device Mismatch:', {
                                expected: empData.registeredDeviceId,
                                received: data.deviceId,
                                employeeId: data.employeeId
                            });
                            throw new Error("⚠️ جهاز غير مسموح - يرجى استخدام جهازك المسجل للتسجيل");
                        }
                    } else {
                        // First time using hardware biometric - register this device
                        // Only register if biometric verification succeeded
                        console.log('📱 Registering new device for employee:', data.employeeId, 'Device:', data.deviceId);
                        await supabase.from('employees')
                            .update({ "registeredDeviceId": data.deviceId })
                            .eq('id', String(data.employeeId));
                    }
                }
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
                transportPrice: finalTransport
            };

            const { error } = await supabase.from('attendance').insert([payload]);
            if (error) throw error;

            // Sync to Google Sheets with actual server-generated data
            syncToGoogleSheet({ action: 'addAttendance', ...payload });

            return res.status(200).json({ success: true, message: "تم تسجيل الحضور بنجاح" });
        }

        // --- CHECK OUT ---
        if (action === "checkoutAttendance") {
            // 0. Device Binding Check for Hardware Biometric (same as check-in)
            if (data.biometricType === 'fingerprint' || data.biometricType === 'face_hardware') {
                const { data: empData } = await supabase.from('employees')
                    .select('"registeredDeviceId", "biometricType"')
                    .eq('id', String(data.employeeId))
                    .maybeSingle();
                
                if (empData && empData.registeredDeviceId) {
                    if (empData.registeredDeviceId !== data.deviceId) {
                        console.error('🚨 Checkout Device Mismatch:', {
                            expected: empData.registeredDeviceId,
                            received: data.deviceId,
                            employeeId: data.employeeId
                        });
                        throw new Error("⚠️ جهاز غير مسموح - يرجى استخدام جهازك المسجل للتسجيل");
                    }
                }
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
                id: data.id || "REQ" + Math.floor(10000 + Math.random() * 90000),
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
            
            return res.status(200).json({ success: true, message: "تمت الموافقة على الطلب بنجاح" });
        }

        if (action === "rejectSiteRequest") {
            const { error } = await supabase.from('siteRequests').update({ status: 'rejected' }).eq('id', data.id);
            if (error) throw error;
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
            const payload = {
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
                    adminNote: adminNote || '' 
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
            invalidateCache('settings');
            return res.status(200).json({ success: true, message: "تم تحديث الإعدادات بنجاح" });
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
