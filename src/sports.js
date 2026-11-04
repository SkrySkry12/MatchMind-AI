import {readCache,writeCache,cacheInfo} from './cache.js';
const BASE=(process.env.FOOTBALL_API_BASE_URL||'https://v3.football.api-sports.io').replace(/\/$/,'');
const TTL={fixtures:180,statistics:900,events:900,lineups:1800,players:1800,injuries:14400,predictions:43200};
const demo=[{id:'demo-1',league:'Demo League',leagueId:0,season:2026,date:new Date().toISOString(),home:{name:'North City'},away:{name:'South United'},status:'NS',demo:true},{id:'demo-2',league:'Demo League',leagueId:0,season:2026,date:new Date(Date.now()+86400000).toISOString(),home:{name:'Royal FC'},away:{name:'Athletic Town'},status:'NS',demo:true}];
const stats={requests:0,cacheHits:0,staleFallbacks:0,remaining:null,limit:null};
async function api(path,{ttl=300}={}){
 const key=process.env.FOOTBALL_API_KEY;if(!key)throw new Error('Brak FOOTBALL_API_KEY w środowisku backendu.');
 const k=path,now=Date.now(),hit=await readCache(k);
 if(hit&&hit.expires>now){stats.cacheHits++;return hit.data;}
 try{
  const response=await fetch(BASE+path,{headers:{'x-apisports-key':key},signal:AbortSignal.timeout(12000)});stats.requests++;
  stats.remaining=response.headers.get('x-ratelimit-requests-remaining');stats.limit=response.headers.get('x-ratelimit-requests-limit');
  if(!response.ok)throw new Error('API-FOOTBALL HTTP '+response.status);
  const data=await response.json();if(data.errors&&Object.keys(data.errors).length)throw new Error('API-FOOTBALL: '+JSON.stringify(data.errors));
  await writeCache(k,data,ttl);return data;
 }catch(error){if(hit){stats.staleFallbacks++;return hit.data;}throw error;}
}
export function getApiUsage(){return {...stats,...cacheInfo(),configured:Boolean(process.env.FOOTBALL_API_KEY)};}
function mapFixture(x){return {id:String(x.fixture.id),date:x.fixture.date,league:x.league.name,leagueId:x.league.id,season:x.league.season,country:x.league.country,logo:x.league.logo,flag:x.league.flag,round:x.league.round,status:x.fixture.status.short,home:{id:x.teams.home.id,name:x.teams.home.name,logo:x.teams.home.logo},away:{id:x.teams.away.id,name:x.teams.away.name,logo:x.teams.away.logo},venue:x.fixture.venue?.name,elapsed:x.fixture.status.elapsed};}
async function attachPrediction(match){
 if(!match.id||match.id.startsWith('demo')||!['NS','TBD'].includes(match.status))return match;
 try{
  const d=await api('/predictions?fixture='+encodeURIComponent(match.id),{ttl:TTL.predictions});
  const p=d.response?.[0]?.predictions;if(!p)return {...match,prediction:null};
  const percent=p.percent||{};
  const values=[Number.parseFloat(percent.home),Number.parseFloat(percent.draw),Number.parseFloat(percent.away)];
  const valid=values.every(Number.isFinite)&&values.reduce((a,b)=>a+b,0)>0;
  const best=valid?['home','draw','away'][values.indexOf(Math.max(...values))]:null;
  return {...match,prediction:{home:valid?values[0]:null,draw:valid?values[1]:null,away:valid?values[2]:null,favorite:best,winner:p.winner?.name||null,advice:p.advice||null,underOver:p.under_over||null,source:'API-FOOTBALL',confidence:valid?Math.max(...values):null,comparison:d.response?.[0]?.comparison||null}};
 }catch(error){return {...match,prediction:null,predictionError:'Szacunek chwilowo niedostępny'};}
}
export async function getFixtures(date){
 const d=date||new Date().toISOString().slice(0,10),data=await api('/fixtures?date='+encodeURIComponent(d),{ttl:TTL.fixtures});
 const fixtures=(data.response||[]).map(mapFixture);
 let cursor=0;const workers=Array.from({length:Math.min(4,fixtures.length)},async()=>{while(cursor<fixtures.length){const i=cursor++;fixtures[i]=await attachPrediction(fixtures[i]);}});
 await Promise.all(workers);
 return {source:'API-FOOTBALL',fixtures};
}
export async function getFixtureStats(id){const data=await api('/fixtures/statistics?fixture='+encodeURIComponent(id),{ttl:TTL.statistics});return {source:'API-FOOTBALL',stats:data.response||[]};}
export async function getMatchBundle(id){
 const q='?fixture='+encodeURIComponent(id);
 const endpoints=[['fixture','/fixtures'+q,TTL.fixtures],['statistics','/fixtures/statistics'+q,TTL.statistics],['events','/fixtures/events'+q,TTL.events],['lineups','/fixtures/lineups'+q,TTL.lineups],['players','/fixtures/players'+q,TTL.players],['injuries','/injuries'+q,TTL.injuries],['predictions','/predictions'+q,TTL.predictions]];
 const entries=await Promise.all(endpoints.map(async([name,path,ttl])=>{try{const r=await api(path,{ttl});return [name,r?.response??[]];}catch(error){return [name,{unavailable:true,reason:error.message}];}}));
 return {source:'API-FOOTBALL',...Object.fromEntries(entries)};
}
