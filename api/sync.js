import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ofegdbbyanyglqewbdlm.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZWdkYmJ5YW55Z2xxZXdiZGxtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjEzOTAzMywiZXhwIjoyMDkxNzE1MDMzfQ.lw2wyo5_U_hXZSebLScV1fqt7eRHPOfFi7Z4XKnswzU';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';
const SYNC_DEFAULT_PASSWORD = process.env.SYNC_DEFAULT_PASSWORD || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const READ_PAGE_SIZE = 1000;
const WRITE_CHUNK_SIZE = 200;
const MAX_ISSUES = 25;

function normalizeString(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function normalizeDigits(value) {
    return String(value)
        .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06F0));
}

function toSafeNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;

    let text = normalizeDigits(value);
    text = text
        .replace(/[\u200f\u200e\s]/g, '')
        .replace(/\u066C/g, '')
        .replace(/,/g, '')
        .replace(/\u060C/g, '')
        .replace(/\u066B/g, '.')
        .replace(/[^\d.\-]/g, '');

    if (!text || text === '-' || text === '.' || text === '-.') return fallback;

    const firstDot = text.indexOf('.');
    if (firstDot !== -1) {
        text = text.substring(0, firstDot + 1) + text.substring(firstDot + 1).replace(/\./g, '');
    }

    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toNullableNumber(value) {
    return toSafeNumber(value, null);
}

function isTruthy(value) {
    if (typeof value === 'boolean') return value;
    const text = normalizeString(value).toLowerCase();
    return text === 'true' || text === '1' || text === 'yes';
}

function parseTimeMs(value) {
    const text = normalizeString(value);
    if (!text) return null;
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : null;
}

function getAttendanceSig(row) {
    const employeeId = normalizeString(row.employeeId);
    const checkIn = normalizeString(row.checkIn);
    if (!employeeId || !checkIn) return null;

    const parsedCheckIn = parseTimeMs(checkIn);
    if (parsedCheckIn !== null) {
        return `${employeeId}_${parsedCheckIn}`;
    }

    // Fallback for legacy non-ISO strings in old sheet rows.
    return `${employeeId}_${checkIn}`;
}

function formatError(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    return error.message || JSON.stringify(error);
}

function pushIssue(issues, message) {
    if (issues.length < MAX_ISSUES) {
        issues.push(message);
    }
}

function toAssignedSitesValue(assignedSites) {
    if (Array.isArray(assignedSites)) {
        return assignedSites.map(normalizeString).filter(Boolean).join(',');
    }
    return normalizeString(assignedSites);
}

function buildEmployeePayload(rawEmployee) {
    const id = normalizeString(rawEmployee.id);
    const email = normalizeString(rawEmployee.email).toLowerCase();
    const phone = normalizeString(rawEmployee.phone);
    const password = normalizeString(rawEmployee.password) || normalizeString(SYNC_DEFAULT_PASSWORD) || phone || id;

    if (!id || !email || !phone || !password) {
        return null;
    }

    return {
        id,
        name: normalizeString(rawEmployee.name) || `Employee ${id}`,
        email,
        password,
        phone,
        role: normalizeString(rawEmployee.role) || 'employee',
        assignedSites: toAssignedSitesValue(rawEmployee.assignedSites),
        faceDescriptor: rawEmployee.faceDescriptor ?? null,
        transportPrice: toSafeNumber(rawEmployee.transportPrice, 0)
    };
}

function buildSitePayload(rawSite) {
    const id = normalizeString(rawSite.id);
    const name = normalizeString(rawSite.name);

    if (!id || !name) {
        return null;
    }

    return {
        id,
        name,
        latitude: toNullableNumber(rawSite.latitude),
        longitude: toNullableNumber(rawSite.longitude),
        radius: toSafeNumber(rawSite.radius, 20),
        transportPrice: toSafeNumber(rawSite.transportPrice, 0),
        mapLink: normalizeString(rawSite.mapLink),
        isTemporary: false
    };
}

function buildAttendancePayload(rawAttendance) {
    const employeeId = normalizeString(rawAttendance.employeeId);
    const checkIn = normalizeString(rawAttendance.checkIn);
    const checkOut = normalizeString(rawAttendance.checkOut);
    if (!employeeId || !checkIn) return null;

    let totalHours = toSafeNumber(rawAttendance.totalHours, null);
    if (totalHours === null && checkOut) {
        const inMs = parseTimeMs(checkIn);
        const outMs = parseTimeMs(checkOut);
        if (inMs !== null && outMs !== null && outMs >= inMs) {
            totalHours = Number(((outMs - inMs) / 36e5).toFixed(2));
        }
    }

    return {
        employeeId,
        employeeName: normalizeString(rawAttendance.employeeName),
        siteId: normalizeString(rawAttendance.siteId),
        siteName: normalizeString(rawAttendance.siteName),
        checkIn,
        checkOut: checkOut || null,
        latitude: toNullableNumber(rawAttendance.latitude),
        longitude: toNullableNumber(rawAttendance.longitude),
        status: normalizeString(rawAttendance.status) || 'present',
        totalHours: totalHours === null ? 0 : totalHours,
        transportPrice: toSafeNumber(rawAttendance.transportPrice, 0)
    };
}

async function fetchAllRows(table, columns) {
    let from = 0;
    const rows = [];

    while (true) {
        const to = from + READ_PAGE_SIZE - 1;
        const { data, error } = await supabase
            .from(table)
            .select(columns)
            .range(from, to);

        if (error) {
            throw new Error(`Failed to read ${table}: ${formatError(error)}`);
        }

        if (!data || data.length === 0) break;
        rows.push(...data);

        if (data.length < READ_PAGE_SIZE) break;
        from += READ_PAGE_SIZE;
    }

    return rows;
}

async function upsertRowsWithFallback(table, rows, issues, issuePrefix) {
    let added = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i += WRITE_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + WRITE_CHUNK_SIZE);
        const { error } = await supabase.from(table).upsert(chunk);

        if (!error) {
            added += chunk.length;
            continue;
        }

        pushIssue(issues, `${issuePrefix} chunk failed: ${formatError(error)}`);

        for (const row of chunk) {
            const { error: rowError } = await supabase.from(table).upsert([row]);
            if (rowError) {
                skipped++;
                pushIssue(issues, `${issuePrefix} row failed (id: ${normalizeString(row.id)}): ${formatError(rowError)}`);
                continue;
            }
            added++;
        }
    }

    return { added, skipped };
}

async function insertRowsWithFallback(table, rows, issues, issuePrefix) {
    let added = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i += WRITE_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + WRITE_CHUNK_SIZE);
        const { error } = await supabase.from(table).insert(chunk);

        if (!error) {
            added += chunk.length;
            continue;
        }

        pushIssue(issues, `${issuePrefix} chunk failed: ${formatError(error)}`);

        for (const row of chunk) {
            const { error: rowError } = await supabase.from(table).insert([row]);
            if (rowError) {
                skipped++;
                pushIssue(issues, `${issuePrefix} row failed (employeeId: ${normalizeString(row.employeeId)}): ${formatError(rowError)}`);
                continue;
            }
            added++;
        }
    }

    return { added, skipped };
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

    try {
        // Fetch latest snapshot from Google Sheets (master backup).
        const gsRes = await fetch(`${GOOGLE_SCRIPT_URL}?action=getDashboardData&t=${Date.now()}`, {
            method: 'GET',
            headers: { Accept: 'application/json' }
        });
        if (!gsRes.ok) throw new Error(`Failed to fetch Google Sheets snapshot (${gsRes.status})`);

        const gsData = await gsRes.json();
        if (!gsData.success) throw new Error(gsData.message || 'Failed to fetch data from Google Sheets');

        const gsEmployees = Array.isArray(gsData.employees) ? gsData.employees : [];
        const gsSites = Array.isArray(gsData.sites) ? gsData.sites : [];
        const gsAttendance = Array.isArray(gsData.attendance) ? gsData.attendance : [];

        const issues = [];
        const stats = {
            employeesAdded: 0,
            employeesSkipped: 0,
            sitesAdded: 0,
            sitesSkipped: 0,
            attendanceAdded: 0,
            attendanceUpdated: 0,
            attendanceSkipped: 0
        };

        // 1) Employees: add only rows missing in Supabase.
        const sbEmployees = await fetchAllRows('employees', 'id');
        const sbEmployeeIds = new Set(sbEmployees.map((row) => normalizeString(row.id)).filter(Boolean));

        const employeesToUpsert = [];
        for (const employee of gsEmployees) {
            const employeeId = normalizeString(employee.id);
            if (!employeeId || sbEmployeeIds.has(employeeId)) continue;

            const payload = buildEmployeePayload(employee);
            if (!payload) {
                stats.employeesSkipped++;
                pushIssue(issues, `Skipped employee with missing required fields (id: ${employeeId || 'unknown'})`);
                continue;
            }
            employeesToUpsert.push(payload);
        }

        if (employeesToUpsert.length > 0) {
            const employeeWriteResult = await upsertRowsWithFallback('employees', employeesToUpsert, issues, 'employees');
            stats.employeesAdded += employeeWriteResult.added;
            stats.employeesSkipped += employeeWriteResult.skipped;
        }

        // Refresh employee IDs after employee sync, attendance needs this FK list.
        const syncedEmployees = await fetchAllRows('employees', 'id');
        const employeeIdSet = new Set(syncedEmployees.map((row) => normalizeString(row.id)).filter(Boolean));

        // 2) Sites: add only non-temporary rows missing in Supabase.
        const sbSites = await fetchAllRows('sites', 'id');
        const sbSiteIds = new Set(sbSites.map((row) => normalizeString(row.id)).filter(Boolean));

        const sitesToUpsert = [];
        for (const site of gsSites) {
            const siteId = normalizeString(site.id);
            if (!siteId || sbSiteIds.has(siteId) || isTruthy(site.isTemporary)) continue;

            const payload = buildSitePayload(site);
            if (!payload) {
                stats.sitesSkipped++;
                pushIssue(issues, `Skipped site with missing required fields (id: ${siteId || 'unknown'})`);
                continue;
            }
            sitesToUpsert.push(payload);
        }

        if (sitesToUpsert.length > 0) {
            const sitesWriteResult = await upsertRowsWithFallback('sites', sitesToUpsert, issues, 'sites');
            stats.sitesAdded += sitesWriteResult.added;
            stats.sitesSkipped += sitesWriteResult.skipped;
        }

        // 3) Attendance: add missing rows and complete missing check-outs.
        const sbAttendance = await fetchAllRows('attendance', 'id, employeeId, checkIn, checkOut');
        const sbAttendanceMap = new Map();

        for (const record of sbAttendance) {
            const sig = getAttendanceSig(record);
            if (!sig) continue;
            if (!sbAttendanceMap.has(sig)) {
                sbAttendanceMap.set(sig, record);
            }
        }

        const attendanceToInsert = [];
        const attendanceToUpdate = [];

        for (const attendance of gsAttendance) {
            const employeeId = normalizeString(attendance.employeeId);
            const sig = getAttendanceSig(attendance);

            if (!sig) {
                stats.attendanceSkipped++;
                pushIssue(issues, 'Skipped attendance row with invalid employeeId/checkIn');
                continue;
            }

            if (!employeeIdSet.has(employeeId)) {
                stats.attendanceSkipped++;
                pushIssue(issues, `Skipped attendance row for unknown employeeId "${employeeId}"`);
                continue;
            }

            const existingRow = sbAttendanceMap.get(sig);
            if (!existingRow) {
                const payload = buildAttendancePayload(attendance);
                if (!payload) {
                    stats.attendanceSkipped++;
                    pushIssue(issues, `Skipped malformed attendance row for employeeId "${employeeId}"`);
                    continue;
                }
                attendanceToInsert.push(payload);
            } else {
                const supabaseCheckOut = normalizeString(existingRow.checkOut);
                const sheetCheckOut = normalizeString(attendance.checkOut);
                if (!supabaseCheckOut && sheetCheckOut && existingRow.id) {
                    attendanceToUpdate.push({
                        id: existingRow.id,
                        checkOut: sheetCheckOut,
                        totalHours: toSafeNumber(attendance.totalHours, null)
                    });
                }
            }
        }

        if (attendanceToInsert.length > 0) {
            const attendanceWriteResult = await insertRowsWithFallback('attendance', attendanceToInsert, issues, 'attendance');
            stats.attendanceAdded += attendanceWriteResult.added;
            stats.attendanceSkipped += attendanceWriteResult.skipped;
        }

        for (const updateRow of attendanceToUpdate) {
            const updatePayload = { checkOut: updateRow.checkOut };
            if (updateRow.totalHours !== null) {
                updatePayload.totalHours = updateRow.totalHours;
            }

            const { error } = await supabase
                .from('attendance')
                .update(updatePayload)
                .eq('id', updateRow.id)
                .is('checkOut', null);

            if (error) {
                stats.attendanceSkipped++;
                pushIssue(issues, `Failed to update attendance checkout (id: ${updateRow.id}): ${formatError(error)}`);
            } else {
                stats.attendanceUpdated++;
            }
        }

        return res.status(200).json({
            success: true,
            message: issues.length ? 'Smart sync completed with warnings' : 'Smart sync completed successfully',
            stats,
            issues
        });

    } catch (e) {
        return res.status(500).json({ success: false, message: formatError(e) });
    }
}
