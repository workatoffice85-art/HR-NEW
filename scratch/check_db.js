const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    console.log('Checking database table records...');
    
    const { data: tgConnections, error: connErr } = await supabase
        .from('employee_telegram')
        .select('*');
        
    if (connErr) {
        console.error('Error fetching employee_telegram:', connErr.message);
    } else {
        console.log('employee_telegram rows:', tgConnections);
    }
    
    const { data: linkTokens, error: tokenErr } = await supabase
        .from('telegram_link_tokens')
        .select('*');
        
    if (tokenErr) {
        console.error('Error fetching telegram_link_tokens:', tokenErr.message);
    } else {
        console.log('telegram_link_tokens rows:', linkTokens);
    }

    const { data: employees, error: empErr } = await supabase
        .from('employees')
        .select('id, name, preferred_notification_channel');
        
    if (empErr) {
        console.error('Error fetching employees:', empErr.message);
    } else {
        console.log('employees list:', employees);
    }
}

check();
