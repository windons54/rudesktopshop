// pages/api/telegram.js — серверный прокси для Telegram Bot API

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { token, chat_id, text, parse_mode } = req.body || {};

  if (!token || !chat_id || !text) {
    return res.status(400).json({ 
      ok: false, 
      description: `Не заполнены поля: ${!token?'token ':''} ${!chat_id?'chat_id ':''} ${!text?'text':''}`.trim()
    });
  }

  // chat_id может быть строкой или числом — Telegram принимает оба варианта,
  // но передаём как есть (строку) — это корректно
  const chatId = String(chat_id).trim();
  const botToken = String(token).trim();

  const payload = { 
    chat_id: chatId, 
    text: String(text), 
    parse_mode: parse_mode || 'HTML' 
  };

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const tgRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    const data = await tgRes.json();
    
    // Логируем для отладки (видно в Vercel Functions logs)
    console.log('TG request:', { url: url.replace(botToken, '***'), chatId, textLen: text.length });
    console.log('TG response:', JSON.stringify(data));
    
    return res.status(200).json(data);
  } catch (e) {
    console.error('TG proxy error:', e);
    return res.status(500).json({ ok: false, description: 'Ошибка сервера: ' + e.message });
  }
}
