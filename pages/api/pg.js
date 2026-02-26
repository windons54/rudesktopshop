// pages/api/pg.js
// PostgreSQL удалён. Этот файл — заглушка для обратной совместимости.
export default function handler(req, res) {
  res.status(410).json({ ok: false, error: 'PostgreSQL отключён. Используйте /api/store.' });
}
