import {readCache,writeCache,cacheInfo} from './cache.js';

const ESPN=(process.env.ESPN_API_BASE_URL||'https://site.api.espn.com').replace(/\/$/,'');
const SPORT=(process.env.SPORTSCORE_API_BASE_URL||'https://sportscore.com').replace(/\/$/,'');
const LEAGUES=[
 ['uefa.champions','UEFA Champions League','Europa'],['uefa.europa','UEFA Europa League','Europa'],
 ['uefa.europa.conf','UEFA Conference League','Europa'],['eng.1','Premier League','Anglia'],
 ['esp.1','La Liga','Hiszpania'],['ger.1','Bundesliga','Niemcy'],['ita.1','Serie A','Włochy'],
 ['fra.1','Ligue 1','Francja'],['ned.1','Eredivisie','Holandia'],['por.1','Primeira Liga','Portugalia'],
 ['pol.1','Ekstraklasa','Polska'],['eng.2','Championship','Anglia'],
 ['uefa.nations','UEFA Nations League','Europa'],['fifa.world','FIFA World Cup','Świat']
];
const LEAGUE_MAP=new Map(LEAGUES.map(x=>[x[0],x]));
const stats={requests:0,cacheHits:0,staleFallbacks:0,failedLeagues:[]};
const TTL={fixtures:180,details:90,team:900};
const str=(v,f='')=>v===undefined||v===null||v===''?f:String(v);
const val=(...v)=>v.find(x=>x!==undefined&&x!==null&&x!=='');
const array=x=>Array.isArray(x)?x:[];
function dayUTC(date){
 const d=str(date,new Date().toISOString().slice(0,10));
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d+'T00:00:00Z')))throw new Error('Nieprawidłowa data terminarza.');
 return d;
}
async function json(base,path,ttl){
 const key='mm:v4:'+base+path,hit=await readCache(key);
 if(hit&&hit.expires>Date.now()){stats.cacheHits++;return hit.data;}
 try{
  const r=await fetch(base+path,{headers:{accept:'application/json','user-agent':'MatchMind-AI/2.0'},signal:AbortSignal.timeout(9000)});
  stats.requests++;
  if(!r.ok)throw new Error('HTTP '+r.status+' ('+new URL(base).hostname+')');
  const d=await r.json();
  await writeCache(key,d,ttl);return d;
 }catch(e){if(hit){stats.staleFallbacks++;return hit.data;}throw e;}
}
function state(s){
 const type=str(s?.type?.name||s?.type?.state||s?.type||s?.name||s?.state).toLowerCase();
 if(s?.type?.completed||/final|post|finish|complete/.test(type))return 'FT';
 if(/in|live|progress|half/.test(type))return 'LIVE';
 if(/cancel|postpon/.test(type))return 'POSTPONED';
 return 'NS';
}
function team(c){
 const t=c?.team||{};
 return {id:val(t.id,null),name:str(t.displayName||t.name||t.shortDisplayName,'Nieznana drużyna'),logo:str(t.logo||t.logos?.[0]?.href),slug:str(t.abbreviation||t.slug)};
}
function eventToMatch(e,league){
 const c=e.competitions?.[0]||{},parts=array(c.competitors);
 const home=parts.find(x=>x.homeAway==='home'),away=parts.find(x=>x.homeAway==='away');
 if(!e.id||!home||!away)return null;
 const when=val(c.date,e.date);
 if(!when||Number.isNaN(Date.parse(when)))return null;
 const l=LEAGUE_MAP.get(league)||[league,league,'Rozgrywki'];
 const id='espn:'+league+':'+str(e.id);
 return {id,slug:id,date:new Date(when).toISOString(),league:l[1],leagueId:league,country:l[2],
  round:str(e.week?.text||e.season?.type?.name||''),status:state(e.status||c.status),
  statusText:str(e.status?.type?.description||c.status?.type?.description),
  home:team(home),away:team(away),venue:str(c.venue?.fullName),
  elapsed:val(e.status?.displayClock,null),
  score:{home:home.score==null?null:Number(home.score),away:away.score==null?null:Number(away.score)},
  prediction:null,source:'ESPN'};
}

function scoreNumber(score){
 const raw=score&&typeof score==='object'?val(score.value,score.displayValue,score.score):score;
 if(raw===null||raw===undefined||raw==='')return null;
 const n=Number(raw);return Number.isFinite(n)?n:null;
}
function resultForTeam(event,teamId){
 const comp=event.competitions?.[0]||{},cs=array(comp.competitors);
 const own=cs.find(x=>String(x.team?.id)===String(teamId)),opp=cs.find(x=>String(x.team?.id)!==String(teamId));
 const status=event.status||comp.status;
 const completed=Boolean(status?.type?.completed)||state(status)==='FT';
 if(!own||!opp||!completed)return null;
 const gf=scoreNumber(own.score),ga=scoreNumber(opp.score);
 if(gf===null||ga===null)return null;
 return {date:val(comp.date,event.date),opponent:opp.team?.displayName||opp.team?.name||'Rywal',gf,ga,result:gf>ga?'W':gf===ga?'D':'L'};
}
function poisson(lambda,k){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}
function estimateProbabilities(h,a){
 // Nie generuj procentów z domyślnych średnich, jeśli historia nie jest dostępna.
 // Minimum 3 zakończone mecze każdej drużyny ogranicza pozorne 50/50 bez danych.
 if(h.length<3||a.length<3)return null;
 const avg=(xs,k)=>xs.reduce((s,x)=>s+x[k],0)/xs.length;
 const hx=Math.max(.2,Math.min(3.8,(avg(h,'gf')+avg(a,'ga'))/2+.18));
 const ax=Math.max(.2,Math.min(3.5,(avg(a,'gf')+avg(h,'ga'))/2-.08));
 let home=0,draw=0,away=0;
 for(let x=0;x<=8;x++)for(let y=0;y<=8;y++){const p=poisson(hx,x)*poisson(ax,y);if(x>y)home+=p;else if(x===y)draw+=p;else away+=p;}
 const t=home+draw+away,n=Math.min(h.length,5)+Math.min(a.length,5);
 return {home:Math.round(home/t*100),draw:Math.round(draw/t*100),away:Math.round(away/t*100),source:'Model statystyczny MatchMind',confidence:n>=8?'średnia':'niska',sampleHome:h.length,sampleAway:a.length,expectedGoals:{home:Number(hx.toFixed(2)),away:Number(ax.toFixed(2))}};
}
const teamPromises=new Map();
async function teamContext(league,teamId,includeInjuries=false){
 if(!teamId)return {form:[],injuries:[],notice:'Brak ID drużyny.'};
 const promiseKey=league+':'+teamId+':'+includeInjuries;if(teamPromises.has(promiseKey))return teamPromises.get(promiseKey);
 const promise=(async()=>{
 const base='/apis/site/v2/sports/soccer/'+league+'/teams/'+encodeURIComponent(teamId);
 const [schedule,injuryData]=await Promise.all([
  json(ESPN,base+'/schedule',TTL.team).catch(()=>null),
  includeInjuries?json(ESPN,base+'/injuries',TTL.team).catch(()=>null):Promise.resolve(null)
 ]);
 const events=array(schedule?.events||schedule?.season?.events||schedule?.data?.events||schedule?.schedule?.events||schedule?.team?.events);
 const form=events.map(e=>resultForTeam(e,teamId)).filter(Boolean).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,5);
 const injuries=array(injuryData?.items||injuryData?.injuries||injuryData?.athletes||injuryData?.data).map(x=>({
  name:x.athlete?.displayName||x.athlete?.fullName||x.displayName||x.name||'Zawodnik',
  status:x.status||x.type||x.details||'Status nieznany'
 })).slice(0,12);
 return {form,injuries,notice:!schedule?'Nie udało się pobrać terminarza drużyny.':form.length<3?'ESPN zwrócił terminarz, ale po odczytaniu wyników dostępnych jest tylko '+form.length+' zakończonych spotkań.':includeInjuries&&!injuryData?'Brak raportu kontuzji od dostawcy.':null};
 })();teamPromises.set(promiseKey,promise);try{return await promise;}finally{teamPromises.delete(promiseKey);}
}
async function enrichFixture(f){
 const [h,a]=await Promise.all([teamContext(f.leagueId,f.home.id),teamContext(f.leagueId,f.away.id)]);
 return {...f,prediction:estimateProbabilities(h.form,a.form),preMatch:{home:h,away:a,notices:[h.notice,a.notice].filter(Boolean)}};
}
async function espnFixtures(day){
 const date=day.replace(/-/g,''),failed=[],settled=await Promise.allSettled(LEAGUES.map(async ([league])=>{
  const data=await json(ESPN,'/apis/site/v2/sports/soccer/'+league+'/scoreboard?dates='+date+'&limit=250',TTL.fixtures);
  if(!Array.isArray(data.events))throw new Error('Nieprawidłowa odpowiedź terminarza '+league);
  return data.events.map(e=>eventToMatch(e,league)).filter(Boolean);
 }));
 const byId=new Map();
 settled.forEach((s,i)=>{if(s.status==='fulfilled'){for(const m of s.value)byId.set(m.id,m);}else failed.push(LEAGUES[i][0]);});
 stats.failedLeagues=failed;
 return {fixtures:[...byId.values()].sort((a,b)=>a.date.localeCompare(b.date)),success:LEAGUES.length-failed.length,failed};
}
function sportList(d){
 if(Array.isArray(d))return d;
 for(const x of [d?.fixtures,d?.matches,d?.data?.fixtures,d?.data?.matches,d?.data?.results,d?.results])if(Array.isArray(x))return x;
 return [];
}
function sportMatch(x){
 const home=x.home_team||x.teams?.home||x.home||{},away=x.away_team||x.teams?.away||x.away||{};
 const hn=str(home.name||home.team_name||x.home_name|| (typeof home==='string'?home:'')),an=str(away.name||away.team_name||x.away_name||(typeof away==='string'?away:''));
 const slug=str(x.slug||x.match_slug||x.url_slug);
 const date=val(x.date,x.start_time,x.kickoff,x.datetime,x.time);
 if(!slug||!hn||!an||!date||Number.isNaN(Date.parse(date)))return null;
 const comp=x.competition||x.league||{},name=str(comp.name||comp.title||x.competition_name||(typeof comp==='string'?comp:''),'Pozostałe rozgrywki');
 return {id:'sportscore:'+slug,slug,date:new Date(date).toISOString(),league:name,leagueId:str(comp.slug),
  country:str(comp.country?.name||comp.country||x.country?.name||x.country),round:str(x.round||x.stage),
  status:str(x.status?.short||x.status||'NS'),statusText:str(x.status_text),
  home:{name:hn,logo:str(home.logo||home.image||x.home_logo)},away:{name:an,logo:str(away.logo||away.image||x.away_logo)},
  score:{home:val(x.home_score,x.score?.home,null),away:val(x.away_score,x.score?.away,null)},prediction:null,source:'SportScore'};
}
async function sportFixtures(day){
 const d=await json(SPORT,'/api/v1/fixtures/?sport=football&date='+day+'&limit=200',TTL.fixtures);
 return sportList(d).map(sportMatch).filter(Boolean);
}
export async function getFixtures(date){
 const day=dayUTC(date);
 const primary=await espnFixtures(day);
 let fixtures=primary.fixtures,source='ESPN',notice=null;
 if(primary.failed.length)notice='Nie udało się pobrać części rozgrywek: '+primary.failed.join(', ')+'.';
 if(primary.success===0){
  try{fixtures=await sportFixtures(day);source='SportScore';notice='ESPN niedostępne. Wyświetlono terminarz zapasowy SportScore; zakres danych może być ograniczony.';}
  catch(e){throw new Error('Nie udało się pobrać terminarza z ESPN ani SportScore: '+e.message);}
 }
 const enriched=await Promise.all(fixtures.map(f=>enrichFixture(f).catch(()=>({...f,prediction:null,preMatch:null}))));
 return {source,fixtures:enriched,updated:new Date().toISOString(),notice,failedLeagues:primary.failed,
  attribution:{label:source==='ESPN'?'ESPN':'Powered by SportScore',url:source==='ESPN'?'https://www.espn.com/soccer/':'https://sportscore.com/'}};
}
function detailTeams(data,fixture){
 const comps=array(data?.header?.competitions),c=comps[0]||{};
 return array(c.competitors).length?c.competitors:array(data?.boxscore?.teams).map(t=>({team:t.team,homeAway:t.homeAway,score:t.score}));
}
function statsFromBox(data){
 return array(data?.boxscore?.players).length||array(data?.boxscore?.teams).length
  ?array(data?.boxscore?.teams).map(t=>({team:t.team,statistics:array(t.statistics).map(s=>({type:s.label||s.name||s.abbreviation,value:val(s.displayValue,s.value,'—')}))}))
  :[];
}
function eventsFromSummary(data){
 const raw=array(data?.details).length?data.details:array(data?.scoringPlays).length?data.scoringPlays:array(data?.plays);
 return raw.map(e=>({type:str(e.type?.text||e.type?.name||e.type),detail:str(e.text||e.description||e.shortText),
  time:{elapsed:val(e.clock?.displayValue,e.clock?.value,e.time?.elapsed,'?')},team:{name:str(e.team?.displayName||e.team?.name)},
  player:{name:str(e.athletesInvolved?.[0]?.displayName||e.player?.displayName)}}));
}
async function espnBundle(id){
 const match=/^espn:([a-z0-9._-]+):(\d+)$/.exec(id);
 if(!match||!LEAGUE_MAP.has(match[1]))throw new Error('Nieprawidłowy identyfikator meczu ESPN.');
 const [,league,event]=match;
 const d=await json(ESPN,'/apis/site/v2/sports/soccer/'+league+'/summary?event='+event,TTL.details);
 const header=d.header||{},competition=header.competitions?.[0]||{},raw={
  id:event,date:competition.date||header.date,
  competitions:[{...competition,competitors:detailTeams(d)}],
  status:competition.status||header.status
 };
 const mapped=eventToMatch(raw,league);
 if(!mapped)throw new Error('ESPN nie zwrócił zespołów lub daty spotkania.');
 const statistics=statsFromBox(d),events=eventsFromSummary(d);
 const lineups=array(d.rosters).map(r=>({team:r.team,players:array(r.roster)}));
 const [homeContext,awayContext]=await Promise.all([teamContext(league,mapped.home.id,true),teamContext(league,mapped.away.id,true)]);
 const prediction=estimateProbabilities(homeContext.form,awayContext.form);
 const injuryRecords=[...homeContext.injuries.map(x=>({...x,team:mapped.home.name})),...awayContext.injuries.map(x=>({...x,team:mapped.away.name}))];
 return {source:'ESPN',fixture:[{fixture:{status:{short:mapped.status,long:mapped.statusText}},goals:mapped.score,teams:{home:mapped.home,away:mapped.away}}],
  match:{...mapped,prediction,preMatch:{home:homeContext,away:awayContext,notices:[homeContext.notice,awayContext.notice].filter(Boolean)}},statistics,events,lineups,players:[],injuries:injuryRecords,predictions:prediction,live:mapped.status==='LIVE',
  refreshAfterSeconds:mapped.status==='LIVE'?30:null,attribution:{label:'ESPN',url:'https://www.espn.com/soccer/'}};
}
async function sportBundle(id){
 const slug=id.slice('sportscore:'.length);
 if(!slug||slug.length>200)throw new Error('Nieprawidłowy identyfikator SportScore.');
 const d=await json(SPORT,'/api/widget/match/?sport=football&slug='+encodeURIComponent(slug),TTL.details);
 const raw=d.match||d.fixture||d.data?.match||d.data||d;
 const mapped=sportMatch({...raw,slug})||null;
 if(!mapped)throw new Error('SportScore nie zwrócił kompletnych szczegółów meczu.');
 return {source:'SportScore',match:mapped,fixture:[{fixture:{status:{short:mapped.status,long:mapped.statusText}},goals:mapped.score,teams:{home:mapped.home,away:mapped.away}}],
  statistics:array(raw.statistics||raw.stats||d.statistics),events:array(raw.events||raw.timeline||d.events),
  lineups:array(raw.lineups||d.lineups),players:[],injuries:[],predictions:null,live:mapped.status==='LIVE',
  attribution:{label:'Powered by SportScore',url:'https://sportscore.com/'}};
}
export async function getMatchBundle(id){
 const key=str(id).trim();
 if(key.startsWith('espn:'))return espnBundle(key);
 if(key.startsWith('sportscore:'))return sportBundle(key);
 throw new Error('Nieznany identyfikator meczu. Odśwież terminarz.');
}
export async function getFixtureStats(id){
 const bundle=await getMatchBundle(id);
 return {source:bundle.source,stats:bundle.statistics,events:bundle.events};
}
export function getApiUsage(){
 return {...stats,...cacheInfo(),configured:true,provider:'ESPN + SportScore (zapasowe)',
  remaining:null,limit:'Źródła publiczne; dostępność zależy od dostawcy'};
}
