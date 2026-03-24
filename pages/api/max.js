// pages/api/max.js — серверный прокси для Max Messenger Bot API

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { token, chat_id, text } = req.body || {};

  if (!token || !chat_id || !text) {
    return res.status(400).json({ 
      ok: false, 
      description: `Не заполнены поля: ${!token?'token ':''} ${!chat_id?'chat_id ':''} ${!text?'text':''}`.trim()
    });
  }

  const chatId = String(chat_id).trim();
  const botToken = String(token).trim();

  // Max Bot API uses /messages endpoint
  const payload = { 
    chat_id: chatId, 
    text: String(text)
  };

  try {
    const url = `https://api.max.buzz/bot/${botToken}/sendMessage`;
    const maxRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    const data = await maxRes.json();
    
    // Логируем для отладки
    console.log('Max request:', { url: url.replace(botToken, '***'), chatId, textLen: text.length });
    console.log('Max response:', JSON.stringify(data));
    
    // Normalize response to {ok, description} format
    if (data.ok !== undefined) {
      return res.status(200).json(data);
    }
    // If response has message.message_id — it's a success
    if (data.message && data.message.message_id) {
      return res.status(200).json({ ok: true, result: data });
    }
    // If response has error
    if (data.error || data.description) {
      return res.status(200).json({ ok: false, description: data.description || data.error || 'Неизвестная ошибка' });
    }
    
    return res.status(200).json({ ok: true, result: data });
  } catch (e) {
    console.error('Max proxy error:', e);
    return res.status(500).json({ ok: false, description: 'Ошибка сервера: ' + e.message });
  }
}
