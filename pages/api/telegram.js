// pages/api/telegram.js — серверный прокси для Telegram Bot API
// Нужен потому что браузер блокирует прямые запросы к api.telegram.org (CORS)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { token, chat_id, text, parse_mode } = req.body || {};

  if (!token || !chat_id || !text) {
    return res.status(400).json({ ok: false, description: 'Не заполнены token, chat_id или text' });
  }

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: parse_mode || 'HTML' }),
    });
    const data = await tgRes.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, description: 'Ошибка сервера: ' + e.message });
  }
}
