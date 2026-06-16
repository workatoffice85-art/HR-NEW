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
    
    // Allow tests in development or with query params
    if (!isCron && !hasSecret && process.env.NODE_ENV !== 'development' && req.query.test !== 'checkin' && req.query.test !== 'checkout') {
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
        let empQuery = supabase.from('employees').select('id, name').eq('role', 'employee');
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

        // 7. Get subscriptions for target employees
        let subQuery = supabase.from('push_subscriptions').select('*').in('employee_id', targetEmployeeIds);
        const { data: subscriptions, error: subError } = await subQuery;
        if (subError) throw subError;

        if (!subscriptions || subscriptions.length === 0) {
            return res.status(200).json({ 
                success: true, 
                message: `No active push subscriptions found for targeted employees. Targeted count: ${targetEmployeeIds.length}`,
                targetedEmployees: targetEmployeeIds
            });
        }

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

        // 9. Send push notifications
        const notificationPromises = subscriptions.map(async (sub) => {
            const pushSubscription = {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth
                }
            };

            try {
                await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
                return { subscriptionId: sub.id, employeeId: sub.employee_id, success: true };
            } catch (err) {
                console.error(`Error sending push notification to subscription ${sub.id}:`, err.message);
                
                // If subscription is expired/unsubscribed (410 Gone / 404 Not Found), delete it from DB
                if (err.statusCode === 410 || err.statusCode === 404) {
                    console.log(`[Push] Subscription ${sub.id} is invalid/gone. Deleting from DB.`);
                    await supabase.from('push_subscriptions').delete().eq('id', sub.id);
                    return { subscriptionId: sub.id, employeeId: sub.employee_id, success: false, reason: 'deleted' };
                }
                
                return { subscriptionId: sub.id, employeeId: sub.employee_id, success: false, reason: err.message };
            }
        });

        const sendResults = await Promise.all(notificationPromises);
        const successCount = sendResults.filter(r => r.success).length;

        return res.status(200).json({
            success: true,
            action,
            cairoTime: cairoTimeString,
            targetedCount: targetEmployeeIds.length,
            attemptedSends: subscriptions.length,
            successfulSends: successCount,
            results: sendResults
        });

    } catch (e) {
        console.error("Cron Reminder Error:", e);
        return res.status(500).json({ success: false, message: e.message });
    }
}
