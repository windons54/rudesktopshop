import { appendDebugLog, clearDebugLog, getDebugLogFilePath, readDebugLogTail } from '../../lib/debug-log.js';

export default function handler(req, res) {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || req.body?.limit || '200', 10) || 200, 1000));

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      file: getDebugLogFilePath(),
      entries: readDebugLogTail(limit),
    });
  }

  if (req.method === 'POST') {
    const action = req.body?.action || 'tail';
    if (action === 'append') {
      const scope = String(req.body?.scope || 'client');
      const message = String(req.body?.message || 'client_event');
      appendDebugLog(scope, message, req.body?.extra || null);
      return res.status(200).json({ ok: true, appended: true, file: getDebugLogFilePath() });
    }
    if (action === 'clear') {
      clearDebugLog();
      appendDebugLog('debug-log', 'cleared_via_api');
      return res.status(200).json({ ok: true, cleared: true, file: getDebugLogFilePath(), entries: [] });
    }
    return res.status(200).json({
      ok: true,
      file: getDebugLogFilePath(),
      entries: readDebugLogTail(limit),
    });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
