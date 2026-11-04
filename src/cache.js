import pg from 'pg';
const {Pool}=pg;
const memory=new Map();
let pool=null,dbReady=false,writesSinceCleanup=0;
export async function initCache(){
 if(!process.env.DATABASE_URL)return false;
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:3000,idleTimeoutMillis:30000});
 try{
  await pool.query(`CREATE TABLE IF NOT EXISTS api_cache (cache_key TEXT PRIMARY KEY, payload JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_api_cache_expiry ON api_cache(expires_at)');
  await pool.query('DELETE FROM api_cache WHERE expires_at < now()');
  dbReady=true;return true;
 }catch(error){console.error('Persistent cache unavailable; using memory cache:',error.message);return false;}
}
export async function readCache(key){
 if(dbReady){try{const r=await pool.query('SELECT payload, expires_at FROM api_cache WHERE cache_key=$1',[key]);if(r.rowCount)return {data:r.rows[0].payload,expires:new Date(r.rows[0].expires_at).getTime()};}catch(e){console.error('Cache read:',e.message);}}
 return memory.get(key)||null;
}
export async function writeCache(key,data,ttlSeconds){
 const expires=Date.now()+ttlSeconds*1000;memory.set(key,{data,expires});
 if(dbReady){try{await pool.query('INSERT INTO api_cache(cache_key,payload,expires_at,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at,updated_at=now()',[key,JSON.stringify(data),new Date(expires)]);writesSinceCleanup++;if(writesSinceCleanup>=100){writesSinceCleanup=0;await pool.query('DELETE FROM api_cache WHERE expires_at < now()');}}catch(e){console.error('Cache write:',e.message);}}
}
export function cacheInfo(){return {storage:dbReady?'PostgreSQL + memory':'memory fallback',persistent:dbReady,cacheEntries:memory.size};}
