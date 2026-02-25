// pages/api/dbkeys.js — показывает ключи из PostgreSQL через Prisma
export default async function handler(req, res) {
  // Защита: доступ только с секретным токеном или в development
  const secret = process.env.DEBUG_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!secret) return res.status(403).json({ error: 'Disabled in production' });
    const token = req.query.secret || req.headers['x-debug-secret'];
    if (token !== secret) return res.status(403).json({ error: 'Invalid secret' });
  }

  if (!process.env.DATABASE_URL) return res.json({ error: 'No DATABASE_URL' });
  try {
    const { default: prisma } = await import('../../lib/prisma.js');
    const rows = await prisma.kv.findMany({
      orderBy: { key: 'asc' },
      select: { key: true, updated_at: true, value: true },
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(
      rows.map(row =>
        `${row.key} [${row.updated_at}]\n  ${String(row.value).substring(0, 100)}`
      ).join('\n\n') || '(пусто)'
    );
  } catch (e) { res.status(500).send('ERROR: ' + e.message); }
}
