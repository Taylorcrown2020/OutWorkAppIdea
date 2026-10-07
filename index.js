'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. See .env.example.');
  process.exit(1);
}

// TLS to the database is on unless DATABASE_SSL=false (local development only).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10
});

const q = (text, params) => pool.query(text, params);

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn((text, params) => client.query(text, params));
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function migrate() {
  await q(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

async function audit(req, userId, action, detail) {
  try {
    await q('INSERT INTO audit_log (user_id, action, detail, ip, user_agent) VALUES ($1,$2,$3,$4,$5)',
      [userId || null, action, JSON.stringify(detail || {}), req ? req.ip : null, req ? String(req.get('user-agent') || '').slice(0, 300) : null]);
  } catch (e) { console.error('audit failed', e.message); }
}

module.exports = { pool, q, tx, migrate, audit };

if (require.main === module) {
  migrate().then(() => { console.log('Database is up to date.'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
