// pages/api/dbkeys.js — показывает ключи из PostgreSQL
export default async function handler(req, res) {
  if (!process.env.DATABASE_URL) return res.json({ error: 'No DATABASE_URL' });
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
    const r = await pool.query('SELECT key, updated_at, LEFT(value::text, 100) as preview FROM kv ORDER BY key');
    await pool.end();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(r.rows.map(row => `${row.key} [${row.updated_at}]\n  ${row.preview}`).join('\n\n') || '(пусто)');
  } catch(e) { res.status(500).send('ERROR: ' + e.message); }
}
