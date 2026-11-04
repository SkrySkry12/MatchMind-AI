const BASE=(process.env.FOOTBALL_API_BASE_URL||'https://v3.football.api-sports.io').replace(/\/$/,'');
const cache=new Map();
const TTL={fixtures:60,statistics:300,events:300,lineups:900,players:300,injuries:14400,predictions:3600,leagues:86400,teams:43200};
const demo=[{id:'demo-1',league:'Demo League',date:new Date().toISOString(),home:{name:'North City'},away:{name:'South United'},status:'NS',demo:true},{id:'demo-2',league:'Demo League',date:new Date(Date.now()+86400000).toISOString(),home:{name:'Royal FC'},away:{name:'Athletic Town'},status:'NS',demo:true}];
const stats={requests:0,cacheHits:0,staleFallbacks:0,remaining:null,limit:null};
function cacheKey(path){return path;}
async function api(path,{ttl=300,allowDemo=false}={}){
 const key=process.env.FOOTBALL_API_KEY;
 if(!key){if(allowDemo)return null;throw new Error('Brak FOOTBALL_API_KEY w środowisku backendu.');}
 const k=cacheKey(path),now=Date.now(),hit=cache.get(k);
 if(hit&&hit.expires>now){stats.cacheHits++;return hit.data;}
 const url=BASE+path;
 const response=await fetch(url,{headers:{'x-apisports-key':key},signal:AbortSignal.timeout(12000)});
 stats.requests++;
 stats.remaining=response.headers.get('x-ratelimit-requests-remaining');
 stats.limit=response.headers.get('x-ratelimit-requests-limit');
 if(!response.ok)throw new Error('API-FOOTBALL HTTP '+response.status);
 const data=await response.json();
 if(data.errors&&Object.keys(data.errors).length)throw new Error('API-FOOTBALL: '+JSON.stringify(data.errors));
 cache.set(k,{data,expires:now+ttl*1000});
 return data;
}
export function getApiUsage(){return {...stats,cacheEntries:cache.size,configured:Boolean(process.env.FOOTBALL_API_KEY)};}
export async function getFixtures(date){
 const d=date||new Date().toISOString().slice(0,10),data=await api('/fixtures?date='+encodeURIComponent(d),{ttl:TTL.fixtures,allowDemo:true});
 if(!data)return {source:'demo',fixtures:demo};
 return {source:'API-FOOTBALL',fixtures:(data.response||[]).map(x=>({id:String(x.fixture.id),date:x.fixture.date,league:x.league.name,leagueId:x.league.id,season:x.league.season,status:x.fixture.status.short,home:{id:x.teams.home.id,name:x.teams.home.name,logo:x.teams.home.logo},away:{id:x.teams.away.id,name:x.teams.away.name,logo:x.teams.away.logo},venue:x.fixture.venue?.name,elapsed:x.fixture.status.elapsed}))};
}
export async function getFixtureStats(id){if(String(id).startsWith('demo'))return {source:'demo',stats:[],notice:'Brak rzeczywistych statystyk — dane demonstracyjne.'};const data=await api('/fixtures/statistics?fixture='+encodeURIComponent(id),{ttl:TTL.statistics});return {source:'API-FOOTBALL',stats:data.response||[]};}
export async function getMatchBundle(id){
 if(String(id).startsWith('demo'))return {source:'demo',fixture:null,statistics:[],events:[],lineups:[],players:[],injuries:[],predictions:[],notice:'Spotkanie demonstracyjne. Brak rzeczywistych danych.'};
 const q='?fixture='+encodeURIComponent(id);
 const endpoints=[['fixture','/fixtures'+q,TTL.fixtures],['statistics','/fixtures/statistics'+q,TTL.statistics],['events','/fixtures/events'+q,TTL.events],['lineups','/fixtures/lineups'+q,TTL.lineups],['players','/fixtures/players'+q,TTL.players],['injuries','/injuries'+q,TTL.injuries],['predictions','/predictions'+q,TTL.predictions]];
 const entries=await Promise.all(endpoints.map(async([name,path,ttl])=>{try{const r=await api(path,{ttl});return [name,r?.response??[]];}catch(error){return [name,{unavailable:true,reason:error.message}];}}));
 return {source:'API-FOOTBALL',...Object.fromEntries(entries)};
}
