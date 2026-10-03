import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
const url=process.env.SEED_DATABASE_URL;
if (!url || process.env.NODE_ENV !== 'development' || !['localhost','127.0.0.1','::1','[::1]'].includes(new URL(url).hostname)) throw Error('LOCAL_DEVELOPMENT_SEED_ONLY');
const pool=new Pool({ connectionString:url });
try { await pool.query(await readFile(new URL('../database/seeds/development.sql',import.meta.url),'utf8')); console.log('Synthetic development fixtures loaded'); }
catch { console.error('SEED_FAILED'); process.exitCode=1; }
finally { await pool.end(); }
