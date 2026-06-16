import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ARCHIVE_CRON_SECRET = process.env.ARCHIVE_CRON_SECRET || '';

// VAPID keys configurations
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BCzvmqK559MDuC8Re6QvQTQ_xiwtd-F52ae7crKawuKIxyWkiwDcrbjgKcSDEy7cE22yoYCcVIpeOJjv-u_ETFs';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'hwARzUTnrl_QEGwIF6YmNY0Ix1aKmLz0kSMWnvqGDSQ';

webpush.setVapidDetails(
    'mailto:support@democompany.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
});

export default async function handler(req, res) {
    // Security check for cron job
    const isCron = req.headers['x-vercel-cron'] === '1' || 
                   req.headers['user-agent']?.includes('vercel-cron');
    const hasSecret = req.query.secret === ARCHIVE_CRON_SECRET;
    const hasCronSecret = req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
    
    // Allow tests in development or with query params or with proper Bearer header
    if (!isCron && !hasSecret && !hasCronSecret && process.env.NODE_ENV !== 'development' && req.query.test !== 'checkin' && req.query.test !== 'checkout') {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const testMode = req.query.test; // 'checkin' or 'checkout'
        const targetEmployeeId = req.query.employeeId;

        // 1. Get current time and date in Cairo
        const cairoTimeString = new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" });
        const cairoDate = new Date(cairoTimeString);
        
        const year = cairoDate.getFullYear();
        const month = String(cairoDate.getMonth() + 1).padStart(2, '0');
        const day = String(cairoDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        const hours = cairoDate.getHours();
        const minutes = cairoDate.getMinutes();
        const dayOfWeek = cairoDate.getDay(); // 0 = Sunday, 1 = Monday, etc.

        // Default scheduler trigger logic:
        // Check-in runs around 08:45 AM Cairo time
        const isCheckInTime = (hours === 8 && minutes >= 45 && minutes < 50);
        
        // Check-out runs at 03:00 PM (15:00), 03:30 PM (15:30), 04:00 PM (16:00), 05:00 PM (17:00) Cairo time
        const isCheckOutTime = 
            (hours === 15 && minutes >= 0 && minutes < 5) || 
            (hours === 15 && minutes >= 30 && minutes < 35) || 
            (hours === 16 && minutes >= 0 && minutes < 5) || 
            (hours === 17 && minutes >= 0 && minutes < 5);

        // Determine request action
        let action = null;
        if (testMode === 'checkin') {
            action = 'checkin';
        } else if (testMode === 'checkout') {
            action = 'checkout';
        } else if (isCheckInTime) {
            action = 'checkin';
        } else if (isCheckOutTime) {
            action = 'checkout';
        }

        if (!action) {
            return res.status(200).json({ 
                success: true, 
                message: "No action scheduled for current time", 
                cairoTime: cairoTimeString,
                details: { hours, minutes, dayOfWeek }
            });
        }

        // Determine time slot for deduplication
        let slot = 'test';
        if (testMode) {
            slot = 'test';
        } else if (action === 'checkin') {
            slot = '08:45';
        } else if (action === 'checkout') {
            if (hours === 15 && minutes >= 0 && minutes < 5) slot = '15:00';
            else if (hours === 15 && minutes >= 30 && minutes < 35) slot = '15:30';
            else if (hours === 16 && minutes >= 0 && minutes < 5) slot = '16:00';
            else if (hours === 17 && minutes >= 0 && minutes < 5) slot = '17:00';
            else slot = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }

        // 2. Fetch system settings to check weekend days
        const { data: setRows } = await supabase.from('settings').select('*').in('key', ['weekendDays']);
        let weekendDays = [5, 6]; // Default: Friday, Saturday
        if (setRows && setRows.length > 0) {
            const weekendRow = setRows.find(r => r.key === 'weekendDays');
            if (weekendRow && weekendRow.value) {
                weekendDays = weekendRow.value.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
            }
        }

        // If today is a weekend and we are not in test mode, skip reminders
        if (weekendDays.includes(dayOfWeek) && !testMode) {
            return res.status(200).json({ 
                success: true, 
                message: "Skipping reminders: today is a weekend day",
                weekendDays,
                dayOfWeek
            });
        }

        // 3. Check official holidays
        if (!testMode) {
            const { data: holiday } = await supabase
                .from('official_holidays')
                .select('*')
                .eq('holidayDate', dateStr)
                .limit(1);

            if (holiday && holiday.length > 0) {
                return res.status(200).json({ 
                    success: true, 
                    message: `Skipping reminders: today is an official holiday (${holiday[0].holidayName})` 
                });
            }
        }

        // 4. Query recent attendance records (last 2 days) to filter active employees
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        
        const { data: recentAttendance, error: attError } = await supabase
            .from('attendance')
            .select('*')
            .gte('checkIn', twoDaysAgo.toISOString());

        if (attError) throw attError;

        // Filter Cairo today attendance records
        const todayAttendance = (recentAttendance || []).filter(r => {
            const rCairoString = new Date(r.checkIn).toLocaleString("en-US", { timeZone: "Africa/Cairo" });
            const rCairoDate = new Date(rCairoString);
            const rYear = rCairoDate.getFullYear();
            const rMonth = String(rCairoDate.getMonth() + 1).padStart(2, '0');
            const rDay = String(rCairoDate.getDate()).padStart(2, '0');
            const rDateStr = `${rYear}-${rMonth}-${rDay}`;
            return rDateStr === dateStr;
        });

        // 5. Query all active employees
        let empQuery = supabase.from('employees').select('id, name, email, preferred_notification_channel').eq('role', 'employee');
        if (targetEmployeeId) {
            empQuery = empQuery.eq('id', targetEmployeeId);
        }
        const { data: employees, error: empError } = await empQuery;
        if (empError) throw empError;

        // 6. Identify target employees based on action
        let targetEmployeeIds = [];
        if (action === 'checkin') {
            // Target employees who have NOT checked in today
            targetEmployeeIds = employees
                .filter(emp => !todayAttendance.some(att => att.employeeId === emp.id))
                .map(emp => emp.id);
        } else if (action === 'checkout') {
            // Target employees who checked in today but have NOT checked out yet
            targetEmployeeIds = employees
                .filter(emp => {
                    const empAtts = todayAttendance.filter(att => att.employeeId === emp.id);
                    if (empAtts.length === 0) return false; // Didn't check in today, so nothing to checkout
                    // Target if there's any session with checkIn but no checkOut
                    return empAtts.some(att => att.checkIn && !att.checkOut);
                })
                .map(emp => emp.id);
        }

        if (targetEmployeeIds.length === 0) {
            return res.status(200).json({ 
                success: true, 
                message: `No employees need reminders for action: ${action}`,
                cairoTime: cairoTimeString
            });
        }

        // Deduplicate targeting based on notification_logs
        let filteredTargetEmployeeIds = [];
        if (!testMode) {
            const { data: sentLogs, error: logErr } = await supabase
                .from('notification_logs')
                .select('employee_id')
                .eq('notification_type', `${action}_reminder`)
                .eq('notification_date', dateStr)
                .eq('slot', slot)
                .eq('status', 'success');

            if (logErr) {
                console.error('[Cron Reminders] Error checking sent logs:', logErr.message);
            }

            const sentEmpIds = new Set(sentLogs ? sentLogs.map(l => l.employee_id) : []);
            filteredTargetEmployeeIds = targetEmployeeIds.filter(id => !sentEmpIds.has(id));
        } else {
            filteredTargetEmployeeIds = targetEmployeeIds;
        }

        if (filteredTargetEmployeeIds.length === 0) {
            return res.status(200).json({ 
                success: true, 
                message: `Reminders already sent for this slot (${slot}) to all targeted employees.`,
                cairoTime: cairoTimeString
            });
        }

        const targetEmployees = employees.filter(emp => filteredTargetEmployeeIds.includes(emp.id));

        // 7. Get subscriptions for target employees
        let subQuery = supabase.from('push_subscriptions').select('*').in('employee_id', filteredTargetEmployeeIds);
        const { data: subscriptions, error: subError } = await subQuery;
        if (subError) throw subError;

        // 7b. Get Telegram connection mappings
        const { data: tgConnections, error: tgError } = await supabase
            .from('employee_telegram')
            .select('*')
            .in('employee_id', filteredTargetEmployeeIds);

        const tgMap = new Map(tgConnections ? tgConnections.map(c => [c.employee_id, c.telegram_chat_id]) : []);
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

        // 8. Prepare notification payload
        const payload = {
            title: action === 'checkin' ? 'تذكير تسجيل الحضور ⏰' : 'تذكير تسجيل الانصراف ⏰',
            body: action === 'checkin' 
                ? 'صباح الخير! يرجى تسجيل حضورك اليوم في موقع العمل.' 
                : 'مرحباً! يرجى التأكد من تسجيل انصرافك في حال انتهاء وقت العمل.',
            icon: '/assets/app_icon.png',
            badge: '/assets/app_icon.png',
            vibrate: [200, 100, 200],
            data: {
                url: '/employee/index.html'
            }
        };

        // Helper: Send Web Push
        async function sendPushToEmployee(empId) {
            const empSubs = subscriptions.filter(sub => sub.employee_id === empId);
            if (empSubs.length === 0) return false;

            let success = false;
            for (const sub of empSubs) {
                const pushSubscription = {
                    endpoint: sub.endpoint,
                    keys: { p256dh: sub.p256dh, auth: sub.auth }
                };
                try {
                    await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
                    success = true;
                } catch (err) {
                    console.error(`[Cron] Push error for sub ${sub.id}:`, err.message);
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        console.log(`[Cron] Subscription ${sub.id} is invalid/gone. Deleting.`);
                        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
                    }
                }
            }
            return success;
        }

        // Helper: Send Telegram Message
        async function sendTelegramToEmployee(empId) {
            const chatId = tgMap.get(empId);
            if (!chatId || !TELEGRAM_BOT_TOKEN) return false;

            const text = action === 'checkin' 
                ? '⏰ تذكير تسجيل الحضور: صباح الخير! يرجى تسجيل حضورك اليوم في موقع العمل.' 
                : '⏰ تذكير تسجيل الانصراف: مرحباً! يرجى التأكد من تسجيل انصرافك في حال انتهاء وقت العمل.';
            try {
                const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: text
                    })
                });
                const tgJson = await tgRes.json();
                if (tgJson.ok) {
                    await supabase
                        .from('employee_telegram')
                        .update({ last_verified_at: new Date().toISOString() })
                        .eq('employee_id', empId);
                    return true;
                }
                return false;
            } catch (err) {
                console.error(`[Cron] Telegram error for employee ${empId}:`, err.message);
                return false;
            }
        }

        // Helper: Send Email Notification
        async function sendEmailToEmployee(email, empName) {
            const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';
            if (!email) return false;

            const text = action === 'checkin'
                ? `مرحباً ${empName}،\n\nصباح الخير! يرجى تسجيل حضورك اليوم في موقع العمل.`
                : `مرحباً ${empName}،\n\nيرجى التأكد من تسجيل انصرافك في حال انتهاء وقت العمل.`;

            const html = `
                <div style="direction: rtl; text-align: right; font-family: sans-serif; padding: 20px; border: 1px solid #eef2f6; border-radius: 12px; max-width: 600px; margin: 0 auto;">
                    <h3 style="color: #6366f1;">⏰ تذكير تسجيل الحضور والانصراف</h3>
                    <p>مرحباً ${empName}،</p>
                    <p>${action === 'checkin' ? 'صباح الخير! يرجى تسجيل حضورك اليوم في موقع العمل.' : 'يرجى التأكد من تسجيل انصرافك في حال انتهاء وقت العمل.'}</p>
                    <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 20px 0;">
                    <p style="font-size: 0.8rem; color: #94a3b8;">&copy; 2026 جميع الحقوق محفوظة لـ Demo Company</p>
                </div>
            `;

            try {
                const response = await fetch(GOOGLE_SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        action: 'sendNotificationEmail',
                        to: [email],
                        subject: action === 'checkin' ? 'تذكير تسجيل الحضور ⏰' : 'تذكير تسجيل الانصراف ⏰',
                        body: text,
                        htmlBody: html
                    }),
                    headers: { 'Content-Type': 'text/plain' }
                });
                const result = await response.json();
                return result.success;
            } catch (err) {
                console.error(`[Cron] Email error for employee ${email}:`, err.message);
                return false;
            }
        }

        // 9. Dispatch reminders sequentially based on preferred channel
        const dispatchResults = [];

        for (const emp of targetEmployees) {
            const pref = emp.preferred_notification_channel || 'both';
            let sentSuccess = false;
            let channelUsed = '';

            if (pref === 'both') {
                // Try push
                const pushSuccess = await sendPushToEmployee(emp.id);
                if (pushSuccess) {
                    sentSuccess = true;
                    channelUsed = 'push';
                }
                // Try Telegram
                const tgSuccess = await sendTelegramToEmployee(emp.id);
                if (tgSuccess) {
                    sentSuccess = true;
                    channelUsed = channelUsed ? 'both' : 'telegram';
                }

                // If both failed, fallback to email
                if (!sentSuccess) {
                    const emailSuccess = await sendEmailToEmployee(emp.email, emp.name);
                    if (emailSuccess) {
                        sentSuccess = true;
                        channelUsed = 'email';
                    }
                }
            } else if (pref === 'push') {
                const pushSuccess = await sendPushToEmployee(emp.id);
                if (pushSuccess) {
                    sentSuccess = true;
                    channelUsed = 'push';
                } else {
                    const tgSuccess = await sendTelegramToEmployee(emp.id);
                    if (tgSuccess) {
                        sentSuccess = true;
                        channelUsed = 'telegram';
                    } else {
                        const emailSuccess = await sendEmailToEmployee(emp.email, emp.name);
                        if (emailSuccess) {
                            sentSuccess = true;
                            channelUsed = 'email';
                        }
                    }
                }
            } else if (pref === 'telegram') {
                const tgSuccess = await sendTelegramToEmployee(emp.id);
                if (tgSuccess) {
                    sentSuccess = true;
                    channelUsed = 'telegram';
                } else {
                    const emailSuccess = await sendEmailToEmployee(emp.email, emp.name);
                    if (emailSuccess) {
                        sentSuccess = true;
                        channelUsed = 'email';
                    }
                }
            } else if (pref === 'email') {
                const emailSuccess = await sendEmailToEmployee(emp.email, emp.name);
                if (emailSuccess) {
                    sentSuccess = true;
                    channelUsed = 'email';
                }
            }

            if (sentSuccess) {
                // Write log to DB (uses DB UNIQUE index for conflict resolution)
                try {
                    await supabase
                        .from('notification_logs')
                        .insert([{
                            employee_id: emp.id,
                            channel: channelUsed,
                            notification_type: `${action}_reminder`,
                            slot: slot,
                            status: 'success',
                            notification_date: dateStr,
                            sent_at: new Date().toISOString()
                        }]);
                } catch (dbErr) {
                    console.log(`[Cron] Log duplicate skipped for employee ${emp.id} due to unique constraint:`, dbErr.message);
                }
                dispatchResults.push({ employeeId: emp.id, success: true, channel: channelUsed });
            } else {
                // Log failed attempt
                try {
                    await supabase
                        .from('notification_logs')
                        .insert([{
                            employee_id: emp.id,
                            channel: pref,
                            notification_type: `${action}_reminder`,
                            slot: slot,
                            status: 'failed',
                            notification_date: dateStr,
                            sent_at: new Date().toISOString()
                        }]);
                } catch (e) {}
                dispatchResults.push({ employeeId: emp.id, success: false });
            }
        }

        return res.status(200).json({
            success: true,
            action,
            cairoTime: cairoTimeString,
            targetedCount: targetEmployeeIds.length,
            filteredCount: filteredTargetEmployeeIds.length,
            results: dispatchResults
        });

    } catch (e) {
        console.error("Cron Reminder Error:", e);
        return res.status(500).json({ success: false, message: e.message });
    }
}
