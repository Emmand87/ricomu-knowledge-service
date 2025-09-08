import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import cron from 'node-cron';
import fs from 'fs';
import { extractPdfText } from './utils/pdfText.js';
import pool from './db.js';
import { embedTexts } from './utils/embed.js';
import { ensureSchema } from './utils/schema.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

await ensureSchema();

app.get('/knowledge/health', (req,res)=> res.json({ ok:true }));

// Ingest: { items:[{source, url?, title?, article?, date_published?, content?}], chunk_size? }
app.post('/knowledge/ingest', async (req,res)=>{
  const { items = [], chunk_size = 1200 } = req.body || {};
  const rowsToInsert = [];

  for (const it of items){
    let text = it.content || '';
    if (!text && it.url){
      const resp = await axios.get(it.url, { responseType: 'arraybuffer' });
      const buf = Buffer.from(resp.data);
      const isPdf = (resp.headers['content-type']||'').includes('pdf') || it.url.toLowerCase().endsWith('.pdf');
      const text = await extractPdfText(buf);
      else {
        const html = buf.toString('utf-8');
        text = html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      }
    }
    if (!text) continue;
    const chunks = chunkText(text, chunk_size);
    let idx=0;
    for (const c of chunks){
      rowsToInsert.push({
        source: it.source || 'unknown',
        url: it.url || null,
        title: it.title || null,
        article: it.article || null,
        date_published: it.date_published || null,
        chunk_id: (it.article || it.title || it.url || 'doc') + '#' + (idx++),
        content: c
      });
    }
  }

  const embeddings = await embedTexts(rowsToInsert.map(r=>r.content));

  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    for (let i=0;i<rowsToInsert.length;i++){
      const r = rowsToInsert[i];
      await client.query(
        `INSERT INTO documents (source,url,title,article,date_published,chunk_id,content,embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [r.source,r.url,r.title,r.article,r.date_published,r.chunk_id,r.content,embeddings[i]]
      );
    }
    await client.query('COMMIT');
  }catch(e){
    await client.query('ROLLBACK'); console.error(e); return res.status(500).json({ error:'Insert failed' });
  }finally{
    client.release();
  }
  res.json({ inserted: rowsToInsert.length });
});

// Search: { queries:[string], k? }
app.post('/knowledge/search', async (req,res)=>{
  const { queries = [], k = 8 } = req.body || {};
  if (!queries.length) return res.json([]);
  const embeds = await embedTexts(queries);
  const client = await pool.connect();
  try{
    const results = [];
    for (let i=0;i<queries.length;i++){
      const qv = embeds[i];
      const r = await client.query(
        `SELECT id, source, url, title, article, date_published, chunk_id, content,
                1 - (embedding <=> $1::vector) AS score
           FROM documents
           ORDER BY embedding <-> $1::vector
           LIMIT $2`,
        [qv, k]
      );
      results.push(...r.rows);
    }
    res.json(results);
  } finally { client.release(); }
});

// Optional cron placeholder
if (process.env.ENABLE_CRON === '1'){
  cron.schedule('0 2 * * *', ()=> console.log('[CRON] placeholder'));
}

app.listen(process.env.PORT||4000, ()=> console.log('Knowledge service on port', process.env.PORT||4000));

function chunkText(t, maxLen){
  const words = (t||'').split(/\s+/);
  const chunks=[]; let cur=[]; let len=0;
  for (const w of words){
    cur.push(w); len += w.length+1;
    if (len >= maxLen){ chunks.push(cur.join(' ')); cur=[]; len=0; }
  }
  if (cur.length) chunks.push(cur.join(' '));
  return chunks;
}
