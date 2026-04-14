import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ofegdbbyanyglqewbdlm.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZWdkYmJ5YW55Z2xxZXdiZGxtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjEzOTAzMywiZXhwIjoyMDkxNzE1MDMzfQ.lw2wyo5_U_hXZSebLScV1fqt7eRHPOfFi7Z4XKnswzU';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';
const FACE_MATCH_THRESHOLD = 0.5;
const LIVENESS_MAX_AGE_MS = 45000;
const LIVENESS_MAX_FUTURE_SKEW_MS = 120000;
const MIN_LIVENESS_BLINKS = 1;
const MIN_LIVENESS_HEAD_SHIFT = 0.05;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

function parseFaceDescriptor(rawDescriptor) {
    if (!rawDescriptor) return null;

    let parsed = rawDescriptor;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch (_) {
            return null;
        }
    }

    if (!Array.isArray(parsed) || parsed.length !== 128) return null;

    const vector = parsed.map((value) => Number(value));
    if (vector.some((value) => !Number.isFinite(value))) return null;
    return vector;
}

function getFaceDistance(vectorA, vectorB) {
    if (!vectorA || !vectorB || vectorA.length !== 128 || vectorB.length !== 128) return Number.POSITIVE_INFINITY;

    let sum = 0;
    for (let i = 0; i < 128; i++) {
        const diff = vectorA[i] - vectorB[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum);
}

function validateLivenessProof(livenessProof) {
    if (!livenessProof || typeof livenessProof !== 'object') {
        return { success: false, message: 'فشل التحقق من الحيوية. حاول مرة أخرى أمام الكاميرا.' };
    }

    const isLive = livenessProof.isLive === true || String(livenessProof.isLive).toLowerCase() === 'true';
    const blinkCount = Number(livenessProof.blinkCount || 0);
    const headShiftScore = Number(livenessProof.headShiftScore || 0);
    const verifiedAtMs = Date.parse(livenessProof.verifiedAt || '');

    if (!isLive) {
        return { success: false, message: 'التحقق الحيوي غير مكتمل. رجاءً أعد حركة الرأس والرمش.' };
    }
    if (!Number.isFinite(verifiedAtMs)) {
        return { success: false, message: 'بيانات التحقق الحيوي غير صالحة.' };
    }

    const ageMs = Date.now() - verifiedAtMs;
    if (ageMs > LIVENESS_MAX_AGE_MS || ageMs < -LIVENESS_MAX_FUTURE_SKEW_MS) {
        return { success: false, message: 'انتهت صلاحية التحقق الحيوي. أعد المحاولة.' };
    }
    if (!Number.isFinite(blinkCount) || blinkCount < MIN_LIVENESS_BLINKS) {
        return { success: false, message: 'لم يتم رصد رمشة كافية للتحقق الحيوي.' };
    }
    if (!Number.isFinite(headShiftScore) || headShiftScore < MIN_LIVENESS_HEAD_SHIFT) {
        return { success: false, message: 'لم يتم رصد حركة رأس كافية للتحقق الحيوي.' };
    }

    return { success: true };
}

async function validateFaceForEmployee(employeeId, incomingDescriptorRaw) {
    const normalizedEmployeeId = normalizeString(employeeId);
    if (!normalizedEmployeeId) {
        return { success: false, message: 'بيانات الموظف غير مكتملة.' };
    }

    const incomingDescriptor = parseFaceDescriptor(incomingDescriptorRaw);
    if (!incomingDescriptor) {
        return { success: false, message: 'لم يتم إرسال بصمة وجه صالحة.' };
    }

    const { data: employee, error } = await supabase
        .from('employees')
        .select('id, faceDescriptor')
        .eq('id', normalizedEmployeeId)
        .maybeSingle();

    if (error) throw error;
    if (!employee) {
        return { success: false, message: 'تعذر العثور على بيانات الموظف.' };
    }

    const storedDescriptor = parseFaceDescriptor(employee.faceDescriptor);
    if (!storedDescriptor) {
        return { success: false, message: 'لا توجد بصمة وجه محفوظة لهذا الموظف.' };
    }

    const distance = getFaceDistance(incomingDescriptor, storedDescriptor);
    if (distance > FACE_MATCH_THRESHOLD) {
        return { success: false, message: 'الوجه غير مطابق لصاحب الحساب.' };
    }

    return { success: true, distance };
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
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
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
        const writeActions = ["saveEmployee", "updateEmployee", "deleteEmployee", "saveSite", "updateSite", "deleteSite", "addSiteRequest", "approveSiteRequest", "rejectSiteRequest", "updateSettings"];
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
            const user = users.find((u) => normalizeString(u.password) === password);
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
                    transportPrice: user.transportPrice
                }
            });
        }
        // --- DASHBOARD DATA (GET) ---
        if (action === "getDashboardData") {
            const [empRes, siteRes, attRes, reqRes, setRes] = await Promise.all([
                supabase.from('employees').select('*'),
                supabase.from('sites').select('*').eq('isTemporary', false),
                supabase.from('attendance').select('*'),
                supabase.from('siteRequests').select('*'),
                supabase.from('settings').select('*')
            ]);
            let settings = {};
            if (setRes.data) {
                setRes.data.forEach(s => settings[s.key] = s.value);
            }
            return res.status(200).json({
                success: true,
                employees: empRes.data || [],
                sites: siteRes.data || [],
                attendance: attRes.data || [],
                siteRequests: reqRes.data || [],
                settings: settings
            });
        }

        // --- EMPLOYEE DASHBOARD INIT ---
        if (action === "getPortalInitialData") {
            const empId = data.employeeId;
            const [siteRes, attRes] = await Promise.all([
                supabase.from('sites').select('*'),
                supabase.from('attendance').select('*').eq('employeeId', empId)
            ]);
            return res.status(200).json({ success: true, sites: siteRes.data || [], attendance: attRes.data || [] });
        }

        if (action === "getAttendance") {
            let query = supabase.from('attendance').select('*');
            if (data.employeeId) query = query.eq('employeeId', data.employeeId);
            const { data: att, error } = await query;
            if (error) throw error;
            return res.status(200).json({ success: true, data: att });
        }

        // --- ADD ATTENDANCE (CHECK-IN) ---
        if (action === "addAttendance") {
            const livenessValidation = validateLivenessProof(data.liveness);
            if (!livenessValidation.success) throw new Error(livenessValidation.message);

            const faceValidation = await validateFaceForEmployee(data.employeeId, data.faceDescriptor);
            if (!faceValidation.success) throw new Error(faceValidation.message);

            // Check Location logic
            const { data: sites } = await supabase.from('sites').select('*');
            let matchedSite = null;
            if (sites) {
                for (let s of sites) {
                    let d = getDistance(data.latitude, data.longitude, s.latitude, s.longitude);
                    if (d <= s.radius) { matchedSite = s; break; }
                }
            }
            if (!matchedSite) {
                // Check if any auto-approved temp site matches
                const { data: reqs } = await supabase.from('siteRequests').select('*').eq('employeeId', data.employeeId).eq('status', 'approved_today');
                if (reqs) {
                    for (let r of reqs) {
                        let d = getDistance(data.latitude, data.longitude, r.latitude, r.longitude);
                        if (d <= (r.tempRadius || 100)) { 
                            matchedSite = { id: r.id, name: r.suggestedName, transportPrice: r.transportPrice }; break; 
                        }
                    }
                }
            }
            if (!matchedSite) throw new Error("أنت خارج نطاق جميع مواقع العمل المسجلة");

            // Calculate status
            let checkInDate = new Date(data.checkIn);
            let dayOfWeek = checkInDate.getDay();
            let status = "present";
            
            const { data: setRows } = await supabase.from('settings').select('*').eq('key', 'workStartTime');
            let workStart = (setRows && setRows.length > 0) ? setRows[0].value : "09:00";
            let checkInTimeStr = checkInDate.toLocaleTimeString('en-US', {hour12:false, hour:'2-digit', minute:'2-digit'});

            if (dayOfWeek === 5 || dayOfWeek === 6) status = "overtime";
            else if (checkInTimeStr > workStart) status = "late";

            const payload = {
                employeeId: data.employeeId,
                employeeName: data.employeeName,
                siteId: matchedSite.id,
                siteName: matchedSite.name,
                checkIn: data.checkIn,
                latitude: data.latitude,
                longitude: data.longitude,
                status: status,
                transportPrice: matchedSite.transportPrice || 0
            };

            const { error } = await supabase.from('attendance').insert([payload]);
            if (error) throw error;
            syncToGoogleSheet(data);
            return res.status(200).json({ success: true, message: "تم تسجيل الحضور بنجاح" });
        }

        // --- CHECK OUT ---
        if (action === "checkoutAttendance") {
            const livenessValidation = validateLivenessProof(data.liveness);
            if (!livenessValidation.success) throw new Error(livenessValidation.message);

            const faceValidation = await validateFaceForEmployee(data.employeeId, data.faceDescriptor);
            if (!faceValidation.success) throw new Error(faceValidation.message);

            const { data: existing, error: errExist } = await supabase.from('attendance')
                .select('*')
                .eq('employeeId', data.employeeId)
                .is('checkOut', null)
                .order('checkIn', { ascending: false })
                .limit(1);
            
            if (errExist || !existing || existing.length === 0) throw new Error("لا يوجد عملية حضور مفتوحة لنسجل الانصراف");

            let cIn = new Date(existing[0].checkIn);
            let cOut = new Date(data.checkOut);
            let hours = ((cOut - cIn) / 36e5).toFixed(2);

            const { error } = await supabase.from('attendance')
                .update({ checkOut: data.checkOut, totalHours: hours })
                .eq('id', existing[0].id);
            if (error) throw error;
            syncToGoogleSheet(data);
            return res.status(200).json({ success: true, message: "تم تسجيل الانصراف الساعات: " + hours });
        }
        
        // Basic proxy fallback for anything else (or we can just implement the rest quickly)
        // If action is none of the above, we can just proxy entirely to Google!
        
        // Proxy Fallback
        const proxyRes = await fetch(GOOGLE_SCRIPT_URL, {
            method: req.method === 'POST' ? 'POST' : 'GET',
            body: req.method === 'POST' ? JSON.stringify(data) : undefined,
            headers: { 'Content-Type': 'text/plain' }
        });
        const proxyJson = await proxyRes.json();
        return res.status(200).json(proxyJson);

    } catch (e) {
        return res.status(200).json({ success: false, message: e.message || e.toString() });
    }
}
