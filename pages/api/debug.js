// pages/api/debug.js
// PostgreSQL удалён. Этот файл — заглушка для обратной совместимости.
export default function handler(req, res) {
  res.status(410).json({ ok: false, error: 'Debug endpoint отключён.' });
}
