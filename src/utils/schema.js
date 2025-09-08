import fs from 'fs';
import pool from '../db.js';
export async function ensureSchema(){
  const sql = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf-8');
  const client = await pool.connect();
  try { await client.query(sql); } finally { client.release(); }
}
