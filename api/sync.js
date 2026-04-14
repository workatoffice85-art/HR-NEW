import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ofegdbbyanyglqewbdlm.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZWdkYmJ5YW55Z2xxZXdiZGxtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjEzOTAzMywiZXhwIjoyMDkxNzE1MDMzfQ.lw2wyo5_U_hXZSebLScV1fqt7eRHPOfFi7Z4XKnswzU';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // Fetch snapshot from Google Sheets (The Backup Master)
        const gsRes = await fetch(GOOGLE_SCRIPT_URL + "?action=getDashboardData");
        const gsData = await gsRes.json();

        if (!gsData.success) throw new Error("Failed to fetch data from Google Sheets");

        let stats = { employeesAdded: 0, sitesAdded: 0, attendanceAdded: 0 };

        // 1. Sync Employees (GS -> Supabase)
        const { data: sbEmp } = await supabase.from('employees').select('id');
        const sbEmpIds = new Set((sbEmp || []).map(e => e.id));

        const empToUpsert = [];
        for (const emp of (gsData.employees || [])) {
            if (!sbEmpIds.has(emp.id)) {
                empToUpsert.push({
                    id: emp.id, name: emp.name, email: emp.email, phone: emp.phone,
                    role: emp.role || 'employee', assignedSites: emp.assignedSites ? emp.assignedSites.join(',') : '',
                    faceDescriptor: emp.faceDescriptor, transportPrice: emp.transportPrice || 0
                });
                stats.employeesAdded++;
            }
        }
        if (empToUpsert.length > 0) await supabase.from('employees').upsert(empToUpsert);


        // 2. Sync Sites (GS -> Supabase)
        const { data: sbSites } = await supabase.from('sites').select('id');
        const sbSiteIds = new Set((sbSites || []).map(s => s.id));

        const sitesToUpsert = [];
        for (const site of (gsData.sites || [])) {
            if (!sbSiteIds.has(site.id) && !site.isTemporary) {
                sitesToUpsert.push({
                    id: site.id, name: site.name, latitude: site.latitude, longitude: site.longitude,
                    radius: site.radius, transportPrice: site.transportPrice, mapLink: site.mapLink
                });
                stats.sitesAdded++;
            }
        }
        if (sitesToUpsert.length > 0) await supabase.from('sites').upsert(sitesToUpsert);


        // 3. Sync Attendance (GS -> Supabase)
        const { data: sbAtt } = await supabase.from('attendance').select('employeeId, checkIn, checkOut');
        
        // Create unique signatures for attendance to prevent duplicates: {employeeId}_{checkInMs}
        const getSig = (a) => `${a.employeeId}_${new Date(a.checkIn).getTime()}`;
        
        const sbAttMap = new Map((sbAtt || []).map(a => [getSig(a), a]));
        const attToUpsert = [];
        const attToUpdate = [];

        for (const att of (gsData.attendance || [])) {
            if (!att.checkIn) continue;
            
            const sig = getSig(att);
            if (!sbAttMap.has(sig)) {
                // Missing in Supabase entirely
                attToUpsert.push({
                    employeeId: att.employeeId, employeeName: att.employeeName,
                    siteId: att.siteId, siteName: att.siteName,
                    checkIn: att.checkIn, checkOut: att.checkOut || null,
                    latitude: att.latitude, longitude: att.longitude,
                    status: att.status, totalHours: att.totalHours || 0, transportPrice: att.transportPrice || 0
                });
                stats.attendanceAdded++;
            } else {
                // Check if Google Sheet has a checkOut time that Supabase lacks
                const sbRecord = sbAttMap.get(sig);
                if (!sbRecord.checkOut && att.checkOut) {
                    attToUpdate.push(supabase
                        .from('attendance')
                        .update({ checkOut: att.checkOut, totalHours: att.totalHours })
                        .eq('employeeId', att.employeeId)
                        .eq('checkIn', att.checkIn)
                    );
                }
            }
        }
        
        if (attToUpsert.length > 0) {
            // Chunked insertion if there's a lot of historical data
            const chunkSize = 200;
            for (let i = 0; i < attToUpsert.length; i += chunkSize) {
                await supabase.from('attendance').insert(attToUpsert.slice(i, i + chunkSize));
            }
        }
        if (attToUpdate.length > 0) {
            await Promise.all(attToUpdate);
        }

        return res.status(200).json({ success: true, message: "تمت المزامنة الذكية بنجاح", stats });

    } catch (e) {
        return res.status(500).json({ success: false, message: e.message || e.toString() });
    }
}
