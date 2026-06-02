import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';
const ARCHIVE_CRON_SECRET = process.env.ARCHIVE_CRON_SECRET || '';

// Retention settings - keep only last 365 days in Supabase
const RETENTION_DAYS = 365;
const ARCHIVE_BATCH_SIZE = 500;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
});

export default async function handler(req, res) {
    // Security check for cron job
    const isCron = req.headers['x-vercel-cron'] === '1' || 
                   req.headers['user-agent']?.includes('vercel-cron');
    const hasSecret = req.query.secret === ARCHIVE_CRON_SECRET;
    
    if (!isCron && !hasSecret && process.env.NODE_ENV !== 'development') {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const results = {
            archived: 0,
            deleted: 0,
            errors: []
        };

        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
        const cutoffISO = cutoffDate.toISOString();

        // 1. Archive old attendance records
        const { data: oldRecords, error: fetchError } = await supabase
            .from('attendance')
            .select('*')
            .lt('checkIn', cutoffISO)
            .order('checkIn', { ascending: true })
            .limit(ARCHIVE_BATCH_SIZE);

        if (fetchError) {
            results.errors.push(`Fetch error: ${fetchError.message}`);
        } else if (oldRecords && oldRecords.length > 0) {
            // Archive to Google Sheets
            const archiveData = {
                action: 'archiveAttendance',
                archivedAt: new Date().toISOString(),
                records: oldRecords,
                retentionDays: RETENTION_DAYS,
                cutoffDate: cutoffISO
            };

            try {
                const gsRes = await fetch(GOOGLE_SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify(archiveData),
                    headers: { 'Content-Type': 'text/plain' }
                });
                
                if (gsRes.ok) {
                    try {
                        const responseData = await gsRes.json();
                        if (responseData && responseData.success === true) {
                            // Delete archived records from Supabase
                            const idsToDelete = oldRecords.map(r => r.id);
                            const { error: deleteError } = await supabase
                                .from('attendance')
                                .delete()
                                .in('id', idsToDelete);

                            if (deleteError) {
                                results.errors.push(`Delete error: ${deleteError.message}`);
                            } else {
                                results.archived += oldRecords.length;
                                results.deleted += oldRecords.length;
                            }
                        } else {
                            results.errors.push(`Google Sheets archive internal failure: ${responseData ? responseData.message : 'Unknown error'}`);
                        }
                    } catch (parseError) {
                        results.errors.push(`Failed to parse Google Sheets response: ${parseError.message}`);
                    }
                } else {
                    results.errors.push(`Google Sheets archive failed: HTTP ${gsRes.status}`);
                }
            } catch (e) {
                results.errors.push(`Archive sync error: ${e.message}`);
            }
        }

        // 2. Clean old site requests (approved/rejected only, older than 90 days)
        const requestCutoff = new Date();
        requestCutoff.setDate(requestCutoff.getDate() - 90);
        
        const { data: oldRequests, error: reqError } = await supabase
            .from('siteRequests')
            .select('id')
            .in('status', ['approved', 'rejected'])
            .lt('timestamp', requestCutoff.toISOString());

        if (!reqError && oldRequests && oldRequests.length > 0) {
            const { error: delReqError } = await supabase
                .from('siteRequests')
                .delete()
                .in('id', oldRequests.map(r => r.id));
            
            if (!delReqError) {
                results.deleted += oldRequests.length;
            }
        }

        // 3. Clean old allowance requests (approved/rejected older than 180 days)
        const allowanceCutoff = new Date();
        allowanceCutoff.setDate(allowanceCutoff.getDate() - 180);
        
        const { data: oldAllowances, error: allError } = await supabase
            .from('allowanceRequests')
            .select('id')
            .in('status', ['approved', 'rejected'])
            .lt('createdAt', allowanceCutoff.toISOString());

        if (!allError && oldAllowances && oldAllowances.length > 0) {
            const { error: delAllError } = await supabase
                .from('allowanceRequests')
                .delete()
                .in('id', oldAllowances.map(r => r.id));
            
            if (!delAllError) {
                results.deleted += oldAllowances.length;
            }
        }

        // 4. Get current database size estimate
        const { data: dbSize, error: sizeError } = await supabase
            .rpc('get_database_size');

        if (!sizeError && dbSize) {
            results.databaseSizeMB = Math.round(dbSize / 1024 / 1024 * 100) / 100;
            results.usagePercent = Math.round((dbSize / (500 * 1024 * 1024)) * 100);
        }

        return res.status(200).json({
            success: true,
            timestamp: new Date().toISOString(),
            retentionDays: RETENTION_DAYS,
            results
        });

    } catch (e) {
        console.error('Archive Error:', e);
        return res.status(500).json({
            success: false,
            message: e.message
        });
    }
}
