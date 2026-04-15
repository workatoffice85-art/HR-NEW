import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ofegdbbyanyglqewbdlm.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZWdkYmJ5YW55Z2xxZXdiZGxtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjEzOTAzMywiZXhwIjoyMDkxNzE1MDMzfQ.lw2wyo5_U_hXZSebLScV1fqt7eRHPOfFi7Z4XKnswzU';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';

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
        const writeActions = ["saveEmployee", "updateEmployee", "deleteEmployee", "saveSite", "updateSite", "deleteSite", "addSiteRequest", "approveSiteRequest", "rejectSiteRequest", "addAttendance", "checkoutAttendance", "updateSettings"];
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
            return res.status(200).json({ success: true, message: "تم تسجيل الحضور بنجاح" });
        }

        // --- CHECK OUT ---
        if (action === "checkoutAttendance") {
            const { data: existing, error: errExist } = await supabase.from('attendance')
                .select('*')
                .eq('employeeId', data.employeeId)
                .is('checkOut', null)
                .order('checkIn', { ascending: false })
                .limit(1);
            
            if (errExist || !existing || existing.length === 0) throw new Error("لا يوجد عملية حضور مفتوحة لنسجل الانصراف");

            const { error } = await supabase.from('attendance')
                .update({ checkOut: data.checkOut })
                .eq('id', existing[0].id);
            if (error) throw error;
            return res.status(200).json({ success: true, message: "تم تسجيل الانصراف بنجاح" });
        }
        
        // --- EMPLOYEE MGMT ---
        if (action === "getEmployees") {
            const { data: emps, error } = await supabase.from('employees').select('*');
            if (error) throw error;
            return res.status(200).json({ success: true, data: emps || [] });
        }

        if (action === "saveEmployee") {
            const allowances = data.siteAllowances || [];
            const payload = {
                id: data.id,
                name: data.name,
                email: data.email,
                phone: data.phone,
                password: data.password,
                role: data.role || 'employee',
                assignedSites: data.assignedSites || '',
                faceDescriptor: data.faceDescriptor || null,
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

            return res.status(200).json({ success: true, message: "تمت إضافة الموظف بنجاح" });
        }

        if (action === "updateEmployee") {
            const allowances = data.siteAllowances || [];
            const payload = {
                name: data.name,
                email: data.email,
                phone: data.phone,
                role: data.role,
                assignedSites: data.assignedSites || '',
                faceDescriptor: data.faceDescriptor || null,
                transportPrice: data.transportPrice || 0
            };
            if (data.password) payload.password = data.password;
            
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

            return res.status(200).json({ success: true, message: "تم تحديث بيانات الموظف بنجاح" });
        }

        if (action === "deleteEmployee") {
            const { error } = await supabase.from('employees').delete().eq('id', data.id);
            if (error) throw error;
            return res.status(200).json({ success: true, message: "تم حذف الموظف بنجاح" });
        }

        // --- SITE MGMT ---
        if (action === "getSites") {
            const { data: sites, error } = await supabase.from('sites').select('*').eq('isTemporary', false);
            if (error) throw error;
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
            return res.status(200).json({ success: true, message: "تم تحديث بيانات الموقع بنجاح" });
        }

        if (action === "deleteSite") {
            const { error } = await supabase.from('sites').delete().eq('id', data.id);
            if (error) throw error;
            return res.status(200).json({ success: true, message: "تم حذف الموقع بنجاح" });
        }

        // --- SITE REQUESTS ---
        if (action === "getSiteRequests") {
            const { data: reqs, error } = await supabase.from('siteRequests').select('*');
            if (error) throw error;
            return res.status(200).json({ success: true, data: reqs || [] });
        }

        if (action === "addSiteRequest") {
            const payload = {
                id: data.id || Math.floor(Math.random() * 1000000),
                employeeId: data.employeeId,
                employeeName: data.employeeName,
                suggestedName: data.suggestedName,
                latitude: data.latitude,
                longitude: data.longitude,
                mapLink: data.mapLink,
                transportPrice: data.transportPrice,
                tempRadius: data.radius,
                note: data.note,
                receiptUrl: data.receiptUrl,
                receiptName: data.receiptName || '',
                status: 'pending',
                timestamp: new Date().toISOString()
            };
            const { error } = await supabase.from('siteRequests').insert([payload]);
            if (error) throw error;
            return res.status(200).json({ success: true, message: "تم إرسال طلب الموقع بنجاح" });
        }

        if (action === "approveSiteRequest") {
            const { id, name, transportPrice, radius, mode, mapLink } = data;
            
            // 1. Update Request table
            const { error: errReq } = await supabase.from('siteRequests')
                .update({ 
                    status: (mode === 'daily' ? 'approved_today' : 'approved'),
                    approvedAt: new Date().toISOString()
                })
                .eq('id', id);
            if (errReq) throw errReq;

            // 2. If permanent, add to sites table
            if (mode === 'permanent') {
                const { data: reqData } = await supabase.from('siteRequests').select('*').eq('id', id).single();
                if (reqData) {
                    const sitePayload = {
                        name: name,
                        latitude: reqData.latitude,
                        longitude: reqData.longitude,
                        radius: radius || 100,
                        transportPrice: transportPrice || 0,
                        mapLink: mapLink || reqData.mapLink,
                        isTemporary: false
                    };
                    const { error: errSite } = await supabase.from('sites').insert([sitePayload]);
                    if (errSite) throw errSite;
                }
            }
            
            return res.status(200).json({ success: true, message: "تمت الموافقة على الطلب بنجاح" });
        }

        if (action === "rejectSiteRequest") {
            const { error } = await supabase.from('siteRequests').update({ status: 'rejected' }).eq('id', data.id);
            if (error) throw error;
            return res.status(200).json({ success: true, message: "تم رفض الطلب بنجاح" });
        }

        // --- SETTINGS ---
        if (action === "getSettings") {
            const { data: sets, error } = await supabase.from('settings').select('*');
            if (error) throw error;
            let settings = {};
            if (sets) sets.forEach(s => settings[s.key] = s.value);
            return res.status(200).json({ success: true, data: settings });
        }

        if (action === "updateSettings") {
            const settings = data.settings;
            const promises = Object.entries(settings).map(([key, value]) => {
                return supabase.from('settings').upsert({ key, value }, { onConflict: 'key' });
            });
            await Promise.all(promises);
            return res.status(200).json({ success: true, message: "تم تحديث الإعدادات بنجاح" });
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
        return res.status(200).json({ success: false, message: e.message || e.toString() });
    }
}
