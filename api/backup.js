import handler from './exec.js';

export default async function backupHandler(req, res) {
    if (req.method === 'GET' && !req.query?.action) {
        req.query = Object.assign({}, req.query, { action: 'getBackupStatus' });
    } else if (req.method === 'POST') {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch(e) { body = {}; }
        }
        if (!body || !body.action) {
            req.body = Object.assign({}, body, { action: 'triggerFullBackup' });
        }
    }
    return handler(req, res);
}
