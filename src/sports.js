import {readCache,writeCache,cacheInfo} from './cache.js';

const BASE=(process.env.SPORTSCORE_API_BASE_URL||'https://sportscore.com').replace(/\\/$/,'');
const SOURCE='SportScore';
const TTL={fixtures:60,match:45,standings:300,team:180};
const stats={requests:0,cacheHits:0,staleFallbacks:0,remaining:null,limit:null};
const LIVE=new Set(['live','in_play','inplay','1h','2h','ht','et','bt','p','playing']);
const FINISHED=new Set(['finished','complete','completed','ft','aet','pen']);

function first(...values){return values.find(v=>v!==undefined&&v!==null&&v!=='');}
function unwrapList(data){
 if(Array.isArray(data))return data;
 for(const key of ['fixtures','matches','results','data','items'])if(Array.isArray(data?.[key]))return data[key];
 return [];
}
function team(raw={},side=''){
 const x=raw?.[side]||raw?.teams?.[side]||raw?.[side+'_team']||{};
 return {id:first(x.id,x.team_id,null),name:first(x.name,x.team_name,typeof raw?.[side]==='string'?raw[side]:null,'Nieznana drużyna'),logo:first(x.logo,x.image,x.crest,null),slug:first(x.slug,x.url_slug,null)};
}
function statusOf(x){
 const raw=String(first(x.status?.short,x.status?.type,x.status,x.state,x.match_status,'upcoming')).toLowerCase();
 if(LIVE.has(raw)||raw.includes('live'))return 'LIVE';
 if(FINISHED.has(raw)||raw.includes('finish')||raw.includes('complete'))return 'FT';
 if(raw==='postponed'||raw==='cancelled'||raw==='canceled')return raw.toUpperCase();
 return 'NS';
}
function mapMatch(x){
 const home=team(x,'home'),away=team(x,'away');
 const date=first(x.date,x.start_time,x.kickoff,x.datetime,x.time,null);
 const comp=x.competition||x.league||x.tournament||{};
 const slug=first(x.slug,x.match_slug,x.url_slug,x.id,x.match_id);
 const id=String(first(x.id,x.match_id,slug,''));
 return {
  id,slug:String(slug||id),date:date?new Date(date).toISOString():new Date().toISOString(),
  league:first(comp.name,comp.title,x.competition_name,x.league_name,'Pozostałe rozgrywki'),
  leagueId:first(comp.id,comp.slug,null),season:first(comp.season,x.season,null),
  country:first(comp.country?.name,comp.country,x.country?.name,x.country,null),
  logo:first(comp.logo,comp.image,null),flag:first(comp.flag,null),
  round:first(x.round,x.stage,null),status:statusOf(x),
  statusText:first(x.status_text,x.status?.text,x.status?.long,null),
  home,away,venue:first(x.venue?.name,x.venue,null),
  elapsed:first(x.minute,x.elapsed,x.time_elapsed,null),
  score:{home:first(x.home_score,x.score?.home,x.scores?.home,x.home?.score,null),away:first(x.away_score,x.score?.away,x.scores?.away,x.away?.score,null)},
  prediction:null,source:SOURCE
 };
}
async function request(path,{ttl=60}={}){
 const key='sportscore:'+path,now=Date.now(),hit=await readCache(key);
 if(hit&&hit.expires>now){stats.cacheHits++;return hit.data;}
 try{
  const response=await fetch(BASE+path,{headers:{accept:'application/json','user-agent':'MatchMind-AI/1.0 (+https://sportscore.com/developers/)','cache-control':'no-cache'},signal:AbortSignal.timeout(12000)});
  stats.requests++;
  if(!response.ok)throw new Error('SportScore HTTP '+response.status);
  const data=await response.json();
  await writeCache(key,data,ttl);return data;
 }catch(error){if(hit){stats.staleFallbacks++;return hit.data;}throw error;}
}
export function getApiUsage(){return {...stats,...cacheInfo(),configured:true,provider:SOURCE,remaining:null,limit:'~10 000 zapytań / 24 h / IP'};}

export async function getFixtures(date){
 const day=date||new Date().toISOString().slice(0,10);
 const data=await request('/api/v1/fixtures/?sport=football&date='+encodeURIComponent(day)+'&limit=200',{ttl:TTL.fixtures});
 const fixtures=unwrapList(data).map(mapMatch).filter(m=>m.id&&m.home.name!=='Nieznana drużyna'&&m.away.name!=='Nieznana drużyna');
 fixtures.sort((a,b)=>new Date(a.date)-new Date(b.date));
 return {source:SOURCE,fixtures,updated:first(data.updated,null),attribution:{label:'Powered by SportScore',url:'https://sportscore.com/'}};
}

export async function getFixtureStats(id){
 const bundle=await getMatchBundle(id);
 return {source:SOURCE,stats:bundle.statistics||[],events:bundle.events||[]};
}

export async function getMatchBundle(id){
 const slug=String(id||'').trim();
 if(!slug||slug.length>200)throw new Error('Nieprawidłowy identyfikator meczu.');
 const data=await request('/api/widget/match/?sport=football&slug='+encodeURIComponent(slug),{ttl:TTL.match});
 const raw=data.match||data.fixture||data.data||data;
 const mapped=mapMatch(raw);
 const timeline=first(raw.timeline,raw.events,raw.incidents,data.timeline,data.events,[]);
 const lineups=first(raw.lineups,raw.lineup,data.lineups,[]);
 const statistics=first(raw.statistics,raw.stats,data.statistics,data.stats,[]);
 const status=statusOf(raw);
 return {source:SOURCE,fixture:[{...raw,fixture:{status:{short:status,long:first(raw.status_text,raw.status?.text,status)}},goals:{home:mapped.score.home,away:mapped.score.away},teams:{home:mapped.home,away:mapped.away}}],match:mapped,statistics,events:Array.isArray(timeline)?timeline:[],lineups:Array.isArray(lineups)?lineups:[],players:[],injuries:[],predictions:null,live:status==='LIVE',refreshAfterSeconds:status==='LIVE'?30:null,attribution:{label:'Powered by SportScore',url:'https://sportscore.com/'}};
}
