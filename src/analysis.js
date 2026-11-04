import {getMatchBundle} from './sports.js';
import {getManualStats} from './store.js';
import {readCache,writeCache} from './cache.js';
const ANALYSIS_CACHE_TTL=20*60;
const systemPrompt='Jesteś analitykiem piłkarskim MatchMind AI. Analizuj wyłącznie dostarczone fakty. Uwzględniaj ostatnie 5 meczów, gole strzelone i stracone, punkty na mecz, czyste konta, mecze bez gola, BTTS, over 2.5, serię wyników, przewagę własnego boiska, statystyki sezonowe oraz potwierdzone absencje. Nie traktuj samych zwycięstw i porażek jako pełnej analizy. Nie wymyślaj danych ani składów. Oddziel fakty od szacunków, wskaż brakujące dane i czynniki ryzyka. Nie zawyżaj pewności. Pisz po polsku, czytelnie, z krótkimi nagłówkami i maksymalnie 300 słowami.';
function summarizeForm(form){
 if(!Array.isArray(form)||!form.length)return null;
 const wins=form.filter(x=>x.result==='W').length,draws=form.filter(x=>x.result==='D').length,losses=form.filter(x=>x.result==='L').length;
 const scored=form.reduce((n,x)=>n+(Number(x.gf)||0),0),conceded=form.reduce((n,x)=>n+(Number(x.ga)||0),0);
 const cleanSheets=form.filter(x=>Number(x.ga)===0).length,failedToScore=form.filter(x=>Number(x.gf)===0).length;
 const btts=form.filter(x=>Number(x.gf)>0&&Number(x.ga)>0).length,over25=form.filter(x=>(Number(x.gf)+Number(x.ga))>=3).length;
 const points=wins*3+draws;
 const lastThree=form.slice(0,3),previous=form.slice(3);
 const recentPoints=lastThree.reduce((n,x)=>n+(x.result==='W'?3:x.result==='D'?1:0),0);
 const previousPoints=previous.reduce((n,x)=>n+(x.result==='W'?3:x.result==='D'?1:0),0);
 let streak=0;for(const x of form){if(!streak)streak=x.result;else if(x.result===streak)streak+='';else break;}
 return {matches:form.length,wins,draws,losses,goalsFor:scored,goalsAgainst:conceded,points,pointsPerMatch:Number((points/form.length).toFixed(2)),goalsForPerMatch:Number((scored/form.length).toFixed(2)),goalsAgainstPerMatch:Number((conceded/form.length).toFixed(2)),cleanSheets,failedToScore,btts,over25,recentPoints,previousPoints,trend:lastThree.length&&previous.length?(recentPoints>previousPoints?'poprawa':recentPoints<previousPoints?'pogorszenie':'stabilna'): 'za mała próbka'};
}
function readableSeasonStats(statistics,homeName,awayName){
 if(!Array.isArray(statistics)||!statistics.length)return [];
 return statistics.map(group=>{
  const teamName=group?.team?.displayName||group?.team?.name||'Drużyna';
  const values=Array.isArray(group?.statistics)?group.statistics:[];
  const selected=values.filter(x=>/goal|assist|win|loss|draw|shot|clean|conced|possession|corner|card|save|game|match/i.test(String(x.type||''))).slice(0,12);
  if(!selected.length)return null;
  return teamName+': '+selected.map(x=>String(x.type)+': '+String(x.value??'brak')).join('; ')+'.';
 }).filter(Boolean);
}
function compactEvidence(evidence){
 const m=evidence.match,pre=m.match?.preMatch,teams={};
 for(const [side,label] of [['home','Gospodarze'],['away','Goście']]){
  const ctx=pre?.[side]||{},form=Array.isArray(ctx.form)?ctx.form:[],summary=summarizeForm(form);
  teams[side]={label,team:m.match?.[side]?.name||m.match?.[side]?.name||label,form:form.map(x=>({date:x.date,opponent:x.opponent,result:x.result,goalsFor:x.gf,goalsAgainst:x.ga,venue:x.venue})),summary,injuries:(ctx.injuries||[]).map(x=>({name:x.name,status:x.status})),notice:ctx.notice||null};
 }
 return {match:{home:m.match?.home?.name||m.match?.home?.displayName,away:m.match?.away?.name||m.match?.away?.displayName,league:m.match?.league,venue:m.match?.venue,prediction:m.match?.prediction||m.predictions},teams,seasonStats:readableSeasonStats(m.statistics),lineupCount:m.lineups?.length||0,injuryCount:m.injuries?.length||0,notices:pre?.notices||[],manualStatsCount:evidence.manual?.length||0};
}
function deterministicSummary(evidence){
 const m=evidence.match,compact=compactEvidence(evidence),parts=[];
 const p=compact.match.prediction;
 if(p)parts.push('Model wstępny 1/X/2: '+p.home+'/'+p.draw+'/'+p.away+'% (pewność '+(p.confidence||'nieokreślona')+', próba: '+(p.sampleHome??'?')+' meczów gospodarzy i '+(p.sampleAway??'?')+' gości).');
 for(const side of ['home','away']){
  const t=compact.teams[side],f=t.form,s=t.summary;
  if(s){
   parts.push(t.label+' — ostatnie '+s.matches+' meczów: '+s.wins+' zwycięstw, '+s.draws+' remisów, '+s.losses+' porażek; punkty/mecz '+s.pointsPerMatch+'; gole '+s.goalsFor+':'+s.goalsAgainst+' (średnio '+s.goalsForPerMatch+' strzelone i '+s.goalsAgainstPerMatch+' stracone na mecz).');
   parts.push(t.label+' — dodatkowe wskaźniki: czyste konta '+s.cleanSheets+'/'+s.matches+', bez zdobytej bramki '+s.failedToScore+'/'+s.matches+', obie drużyny strzelały '+s.btts+'/'+s.matches+', over 2.5 gola '+s.over25+'/'+s.matches+'. Trend punktowy ostatnich 3 spotkań: '+s.trend+'.');
   if(f.length)parts.push(t.label+' — wyniki chronologicznie od najnowszego: '+f.map(x=>x.result+' '+x.goalsFor+':'+x.goalsAgainst+' vs '+x.opponent+(x.venue?' ('+x.venue+')':'')).join('; ')+'.');
  }else parts.push(t.label+': brak wystarczającej historii wyników.');
  if(t.injuries.length)parts.push(t.label+' — zgłoszone absencje: '+t.injuries.map(x=>x.name+' ('+x.status+')').join(', ')+'.');
  else parts.push(t.label+' — brak potwierdzonych danych o absencjach; nie oznacza to pełnego składu.');
 }
 if(compact.seasonStats.length)parts.push('Statystyki sezonowe: '+compact.seasonStats.join(' '));
 if(compact.lineupCount)parts.push('Dostępne wpisy składów: '+compact.lineupCount+'.');
 if(compact.injuryCount)parts.push('Rekordy absencji w szczegółach meczu: '+compact.injuryCount+'.');
 if(compact.notices.length)parts.push('Ograniczenia: '+compact.notices.join(' '));
 if(evidence.manual?.length)parts.push('Dostępne są '+evidence.manual.length+' ręcznie dodane zestawy statystyk, ale ich pola wymagają weryfikacji przed użyciem.');
 if(!parts.length)parts.push('Brak wystarczających danych do rzetelnej analizy.');
 return parts.join('\n\n')+'\n\nWniosek: dane są niepełne, więc nie należy podawać wysokiej pewności. To analiza statystyczna, nie gwarancja wyniku.';
}
async function askLocalLLM(compact){
 if(process.env.LLM_ENABLED!=='true')throw new Error('Lokalny model AI jest wyłączony.');
 const base=(process.env.OLLAMA_BASE_URL||'http://ollama:11434').replace(/\/$/,'');
 const model=process.env.OLLAMA_MODEL||'qwen3:0.6b';
 const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:false,messages:[{role:'system',content:systemPrompt},{role:'user',content:'/no_think\nPrzygotuj raport z sekcjami: Forma i skuteczność; Statystyki dodatkowe; Absencje i skład; Ocena ryzyka. Wskaż, które dane są nieznane. Nie powtarzaj surowego JSON. Maksymalnie 300 słów:\n'+JSON.stringify(compact)}],options:{temperature:0.15,num_ctx:4096,num_predict:500,num_thread:4},keep_alive:'5m'}),signal:AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS||60000))});
 if(!response.ok)throw new Error('Ollama HTTP '+response.status);
 const data=await response.json();const answer=data.message?.content?.trim();
 if(!answer)throw new Error('Lokalny model nie zwrócił raportu.');
 return answer;
}
function buildQuickReadout(compact){
 const p=compact.match.prediction||null,home=compact.teams.home.summary,away=compact.teams.away.summary;
 const labels=['1 · '+(compact.match.home||'Gospodarze'),'X · Remis','2 · '+(compact.match.away||'Goście')];
 const values=p?[Number(p.home),Number(p.draw),Number(p.away)]:null;
 let pick=null,rationale=[];
 if(values&&values.every(Number.isFinite)){
  const best=Math.max(...values),index=values.indexOf(best);
  pick={code:['1','X','2'][index],label:labels[index],probability:best,confidence:p.confidence||'nieokreślona'};
  rationale.push('Model statystyczny wskazuje '+labels[index]+' ('+best+'%).');
 }else if(home&&away&&home.matches>=3&&away.matches>=3){
  const homeScore=home.pointsPerMatch+(home.goalsForPerMatch-home.goalsAgainstPerMatch)*0.25;
  const awayScore=away.pointsPerMatch+(away.goalsForPerMatch-away.goalsAgainstPerMatch)*0.25;
  if(Math.abs(homeScore-awayScore)>=0.35){
   pick={code:homeScore>awayScore?'1':'2',label:homeScore>awayScore?labels[0]:labels[2],probability:null,confidence:'orientacyjna'};
   rationale.push('Wskazanie porównawcze wynika z punktów i bilansu bramek z ostatnich meczów; brak modelowych procentów.');
  }
 }
 if(home&&away){
  if(home.pointsPerMatch>away.pointsPerMatch)rationale.push('Gospodarze zdobywali więcej punktów na mecz ('+home.pointsPerMatch+' vs '+away.pointsPerMatch+').');
  else if(away.pointsPerMatch>home.pointsPerMatch)rationale.push('Goście zdobywali więcej punktów na mecz ('+away.pointsPerMatch+' vs '+home.pointsPerMatch+').');
  if(home.goalsForPerMatch>away.goalsForPerMatch)rationale.push('Gospodarze strzelali średnio więcej goli ('+home.goalsForPerMatch+' vs '+away.goalsForPerMatch+').');
  else if(away.goalsForPerMatch>home.goalsForPerMatch)rationale.push('Goście strzelali średnio więcej goli ('+away.goalsForPerMatch+' vs '+home.goalsForPerMatch+').');
 }
 const stats=side=>side?{matches:side.matches,record:side.wins+'W · '+side.draws+'R · '+side.losses+'P',pointsPerMatch:side.pointsPerMatch,goals:side.goalsFor+':'+side.goalsAgainst,goalsForPerMatch:side.goalsForPerMatch,goalsAgainstPerMatch:side.goalsAgainstPerMatch,cleanSheets:side.cleanSheets,failedToScore:side.failedToScore,btts:side.btts,over25:side.over25,trend:side.trend}:null;
 return {pick,probabilities:p?{home:p.home,draw:p.draw,away:p.away}:null,confidence:p?.confidence||'brak modelu',sampleHome:p?.sampleHome||home?.matches||0,sampleAway:p?.sampleAway||away?.matches||0,home:stats(home),away:stats(away),rationale,warning:!home||!away||home.matches<3||away.matches<3?'Próbka danych jest ograniczona. Nie traktuj tego jako pewnego typu.':'Wskazanie statystyczne, nie gwarancja wyniku.'};
}
export async function analyzeMatch(matchId,extra={}){
 const model=process.env.OLLAMA_MODEL||'qwen3:0.6b',forceRefresh=extra.forceRefresh===true;
 const cacheKey='analysis:v7:'+String(matchId)+':'+model;
 const cached=await readCache(cacheKey);
 if(!forceRefresh&&cached&&cached.expires>Date.now())return {...cached.data,cached:true};
 let match,providerNotice=null;
 try{match=await getMatchBundle(matchId,{forceRefresh});}catch(error){
  if(!extra.fixture)throw error;
  providerNotice='Dostawca nie udostępnił szczegółów meczu ('+error.message+'). Wykorzystano tylko dane terminarza.';
  match={source:'SportScore',match:extra.fixture,fixture:[],statistics:[],events:[],lineups:[],players:[],injuries:[],predictions:null,live:extra.fixture.status==='LIVE'};
 }
 const manual=await getManualStats(matchId),evidence={match,manual};
 const compact=compactEvidence(evidence);
 let report,mode='statistics-only',llmNotice=providerNotice;
 try{report=await askLocalLLM(compact);mode='local-llm';}
 catch(error){report=deterministicSummary(evidence);llmNotice=[providerNotice,'Model AI niedostępny: '+error.message+'. Wyświetlono analizę statystyczną.'].filter(Boolean).join(' ');}
 const result={mode,provider:mode==='local-llm'?'Ollama':null,model:mode==='local-llm'?model:null,report,quick:buildQuickReadout(compact),llmNotice,cached:false};
 if(mode==='local-llm')await writeCache(cacheKey,result,ANALYSIS_CACHE_TTL);
 return result;
}
