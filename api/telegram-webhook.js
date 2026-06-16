import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
});

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 1. Webhook Secret validation for security
    if (TELEGRAM_WEBHOOK_SECRET) {
        const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
        if (receivedSecret !== TELEGRAM_WEBHOOK_SECRET) {
            console.warn('[Telegram Webhook] Unauthorized request - Secret Token mismatch');
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
    }

    try {
        const update = req.body;
        console.log('[Telegram Webhook] Received update:', JSON.stringify(update));

        // We only care about text messages
        if (!update || !update.message || !update.message.text) {
            return res.status(200).json({ ok: true });
        }

        const chatId = update.message.chat.id;
        const text = update.message.text.trim();

        // Check for /start command
        if (text.startsWith('/start')) {
            const parts = text.split(' ');
            if (parts.length < 2) {
                await sendTelegramMessage(chatId, '⚠️ يرجى استخدام رابط الربط المخصص لك من لوحة التحكم في بوابة الموظف لإكمال عملية الربط.');
                return res.status(200).json({ ok: true });
            }

            const token = parts[1].trim();

            // Find valid token in database
            const { data: linkToken, error: tokenErr } = await supabase
                .from('telegram_link_tokens')
                .select('*')
                .eq('token', token)
                .maybeSingle();

            if (tokenErr) {
                console.error('[Telegram Webhook] Database error fetching token:', tokenErr.message);
                await sendTelegramMessage(chatId, '❌ حدث خطأ في النظام أثناء معالجة طلبك. يرجى المحاولة لاحقاً.');
                return res.status(200).json({ ok: true });
            }

            if (!linkToken) {
                await sendTelegramMessage(chatId, '❌ رمز الربط هذا غير صالح أو قد تم استخدامه من قبل.');
                return res.status(200).json({ ok: true });
            }

            // Check if token has expired (30 mins limit)
            const expiresAt = new Date(linkToken.expires_at);
            if (expiresAt < new Date()) {
                // Delete expired token
                await supabase.from('telegram_link_tokens').delete().eq('token', token);
                await sendTelegramMessage(chatId, '❌ انتهت صلاحية رمز الربط (أقصى مدة للربط هي 30 دقيقة). يرجى طلب رابط جديد من لوحة التحكم.');
                return res.status(200).json({ ok: true });
            }

            const employeeId = linkToken.employee_id;

            // Link the employee to the Telegram Chat ID
            // Since employee_id is the PRIMARY KEY, we can upsert
            const { error: upsertErr } = await supabase
                .from('employee_telegram')
                .upsert({
                    employee_id: employeeId,
                    telegram_chat_id: String(chatId),
                    linked_at: new Date().toISOString(),
                    last_verified_at: new Date().toISOString()
                }, { onConflict: 'employee_id' });

            if (upsertErr) {
                console.error('[Telegram Webhook] Upsert connection error:', upsertErr.message);
                await sendTelegramMessage(chatId, '❌ فشل ربط حسابك في قاعدة البيانات. يرجى المحاولة لاحقاً.');
                return res.status(200).json({ ok: true });
            }

            // Delete the used token
            await supabase.from('telegram_link_tokens').delete().eq('token', token);

            // Fetch employee name
            const { data: employee } = await supabase
                .from('employees')
                .select('name')
                .eq('id', employeeId)
                .maybeSingle();

            const nameText = employee ? ` ${employee.name}` : '';
            await sendTelegramMessage(chatId, `✅ تم ربط حساب تيليجرام بنجاح بنظام الحضور والانصراف للموظف:${nameText}!\nستصلك التذكيرات اليومية هنا مباشرة.`);
        } else {
            // Echo back/Help instruction if they write any other message
            await sendTelegramMessage(chatId, '🔔 هذا البوت مخصص لإرسال تذكيرات تسجيل الحضور والانصراف تلقائياً للموظفين.\n\nيمكنك التحكم في التفضيلات من لوحة التحكم في بوابة الموظف الخاصة بك.');
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[Telegram Webhook] Exception occurred:', err);
        return res.status(500).json({ error: err.message });
    }
}

async function sendTelegramMessage(chatId, text) {
    if (!TELEGRAM_BOT_TOKEN) {
        console.error('[Telegram Webhook] TELEGRAM_BOT_TOKEN is missing');
        return;
    }
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text
            })
        });
    } catch (e) {
        console.error('[Telegram Webhook] Failed to send telegram confirmation:', e.message);
    }
}
