import {getMatchBundle} from './sports.js';
import {getManualStats} from './store.js';
import {readCache,writeCache,saveForecast} from './cache.js';
const ANALYSIS_CACHE_TTL=20*60;
const systemPrompt='Jesteś analitykiem piłkarskim MatchMind AI. Analizuj wyłącznie dostarczone fakty. Uwzględniaj ostatnie 5 meczów, gole strzelone i stracone, punkty na mecz, czyste konta, mecze bez gola, BTTS, over 2.5, serię wyników, przewagę własnego boiska, statystyki sezonowe oraz potwierdzone absencje. Nie traktuj samych zwycięstw i porażek jako pełnej analizy. Nie wymyślaj danych ani składów. Oddziel fakty od szacunków, wskaż brakujące dane i czynniki ryzyka. Nie zawyżaj pewności. Pisz po polsku, czytelnie, z krótkimi nagłówkami i maksymalnie 300 słowami.';
function summarizeWindow(form){
 if(!form.length)return null;
 const wins=form.filter(x=>x.result==='W').length,draws=form.filter(x=>x.result==='D').length,losses=form.filter(x=>x.result==='L').length;
 const goalsFor=form.reduce((n,x)=>n+(Number(x.gf)||0),0),goalsAgainst=form.reduce((n,x)=>n+(Number(x.ga)||0),0);
 const points=wins*3+draws,matches=form.length;
 return {matches,wins,draws,losses,points,pointsPerMatch:Number((points/matches).toFixed(2)),goalsFor,goalsAgainst,goalsForPerMatch:Number((goalsFor/matches).toFixed(2)),goalsAgainstPerMatch:Number((goalsAgainst/matches).toFixed(2)),cleanSheets:form.filter(x=>Number(x.ga)===0).length,failedToScore:form.filter(x=>Number(x.gf)===0).length,btts:form.filter(x=>Number(x.gf)>0&&Number(x.ga)>0).length,over25:form.filter(x=>(Number(x.gf)+Number(x.ga))>=3).length,goalDifference:goalsFor-goalsAgainst};
}
function summarizeForm(form){
 if(!Array.isArray(form)||!form.length)return null;
 const last5=summarizeWindow(form.slice(0,5)),last10=summarizeWindow(form.slice(0,10));
 const previous5=form.slice(5,10),previousSummary=summarizeWindow(previous5);
 const streakResult=form[0]?.result;let streak=0;for(const x of form){if(x.result!==streakResult)break;streak++;}
 const trendDelta=last5&&previousSummary?Number((last5.pointsPerMatch-previousSummary.pointsPerMatch).toFixed(2)):null;
 const trend=trendDelta===null?'brak porównywalnej próbki':trendDelta>=0.6?'wyraźna poprawa':trendDelta>=0.2?'lekka poprawa':trendDelta<=-0.6?'wyraźne pogorszenie':trendDelta<=-0.2?'lekkie pogorszenie':'stabilna forma';
 const venue=type=>summarizeWindow(form.filter(x=>x.venue===type));
 return {...last10,record:last10.wins+'W · '+last10.draws+'R · '+last10.losses+'P',last5,last10,previous5:previousSummary,trend,trendDelta,streak:{result:streakResult||null,matches:streak},home:venue('dom'),away:venue('wyjazd')};
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
    if(s.last5&&s.last10)parts.push(t.label+' — forma 5/10: ostatnie 5: '+s.last5.pointsPerMatch+' pkt/mecz, bilans '+s.last5.goalsFor+':'+s.last5.goalsAgainst+'; ostatnie 10: '+s.last10.pointsPerMatch+' pkt/mecz, bilans '+s.last10.goalsFor+':'+s.last10.goalsAgainst+'. Trend względem poprzednich 5: '+s.trend+' ('+s.trendDelta+' pkt/mecz).');
    if(s.streak?.matches)parts.push(t.label+' — seria: '+s.streak.matches+' kolejnych '+({W:'zwycięstw',D:'remisów',L:'porażek'}[s.streak.result]||'wyników')+'.');
    if(s.home||s.away)parts.push(t.label+' — rozdział lokalizacji: u siebie '+(s.home?s.home.pointsPerMatch+' pkt/mecz, gole '+s.home.goalsFor+':'+s.home.goalsAgainst:'brak próbki')+'; na wyjeździe '+(s.away?s.away.pointsPerMatch+' pkt/mecz, gole '+s.away.goalsFor+':'+s.away.goalsAgainst:'brak próbki')+'.');
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
async function askAbacusAI(compact){
 const apiKey=process.env.ABACUS_API_KEY;
 if(!apiKey)throw new Error('Brak ABACUS_API_KEY — Abacus.AI nie jest skonfigurowany.');
 const base=(process.env.ABACUS_BASE_URL||'https://routellm.abacus.ai/v1').replace(/\/$/,'');
 const model=process.env.ABACUS_MODEL||'route-llm';
 const response=await fetch(base+'/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:systemPrompt},{role:'user',content:'Przygotuj zwięzłe podsumowanie meczu w sekcjach: forma i skuteczność, statystyki dodatkowe, absencje i skład, ocena ryzyka. Nie wymyślaj brakujących danych. Nie podawaj rekomendacji jako pewnego typu. Dane wejściowe:\n'+JSON.stringify(compact)}],temperature:0.15,max_tokens:500}),signal:AbortSignal.timeout(Number(process.env.ABACUS_TIMEOUT_MS||45000))});
 if(!response.ok){const detail=await response.text().catch(()=> '');throw new Error('Abacus.AI HTTP '+response.status+(detail?' — '+detail.slice(0,250):''));}
 const data=await response.json(),answer=data.choices?.[0]?.message?.content?.trim();
 if(!answer)throw new Error('Abacus.AI nie zwrócił raportu.');
 return {answer,model:data.model||model};
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

function poissonProbability(lambda,k){let value=Math.exp(-lambda);for(let i=1;i<=k;i++)value*=lambda/i;return value;}
function expectedGoalsModel(home,away){
 if(!home||!away||home.matches<3||away.matches<3)return {available:false,reason:'Za mało danych: potrzeba co najmniej 3 ostatnich meczów każdej drużyny.'};
 const blend=(s)=>{const recent=s.last5?.goalsForPerMatch??s.goalsForPerMatch;const long=s.last10?.goalsForPerMatch??s.goalsForPerMatch;return recent*.6+long*.4;};
 const concede=(s)=>{const recent=s.last5?.goalsAgainstPerMatch??s.goalsAgainstPerMatch;const long=s.last10?.goalsAgainstPerMatch??s.goalsAgainstPerMatch;return recent*.6+long*.4;};
 const shrink=(value,n)=>1.25+(value-1.25)*(n/(n+5));
 const hAttack=shrink(blend(home),home.matches),aDefence=shrink(concede(away),away.matches);
 const aAttack=shrink(blend(away),away.matches),hDefence=shrink(concede(home),home.matches);
 const lambdaHome=Math.max(.15,Math.min(4.5,(hAttack+aDefence)/2*1.08));
 const lambdaAway=Math.max(.15,Math.min(4.5,(aAttack+hDefence)/2*.92));
 const maxGoals=9,ph=Array.from({length:maxGoals+1},(_,k)=>poissonProbability(lambdaHome,k)),pa=Array.from({length:maxGoals+1},(_,k)=>poissonProbability(lambdaAway,k));
 let homeWin=0,draw=0,awayWin=0,over15=0,over25=0,over35=0,btts=0,best={score:'',probability:0};
 for(let h=0;h<=maxGoals;h++)for(let a=0;a<=maxGoals;a++){const prob=ph[h]*pa[a];if(h>a)homeWin+=prob;else if(h===a)draw+=prob;else awayWin+=prob;if(h+a>=2)over15+=prob;if(h+a>=3)over25+=prob;if(h+a>=4)over35+=prob;if(h>0&&a>0)btts+=prob;if(prob>best.probability)best={score:h+':'+a,probability:prob};}
 return {available:true,lambdaHome:Number(lambdaHome.toFixed(2)),lambdaAway:Number(lambdaAway.toFixed(2)),lambdaTotal:Number((lambdaHome+lambdaAway).toFixed(2)),homeWin:Number((homeWin*100).toFixed(1)),draw:Number((draw*100).toFixed(1)),awayWin:Number((awayWin*100).toFixed(1)),over15:Number((over15*100).toFixed(1)),over25:Number((over25*100).toFixed(1)),over35:Number((over35*100).toFixed(1)),btts:Number((btts*100).toFixed(1)),mostLikelyScore:best.score,scoreProbability:Number((best.probability*100).toFixed(1)),sampleHome:home.matches,sampleAway:away.matches,method:'Poisson · forma bramkowa 5/10 · korekta do średniej 1.25 gola · przewaga gospodarzy'};
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
 const stats=side=>side?{matches:side.matches,record:side.record,pointsPerMatch:side.pointsPerMatch,goals:side.goalsFor+':'+side.goalsAgainst,goalsForPerMatch:side.goalsForPerMatch,goalsAgainstPerMatch:side.goalsAgainstPerMatch,cleanSheets:side.cleanSheets,failedToScore:side.failedToScore,btts:side.btts,over25:side.over25,trend:side.trend,trendDelta:side.trendDelta,last5:side.last5,last10:side.last10,previous5:side.previous5,streak:side.streak,home:side.home,away:side.away}:null;
 const goals=expectedGoalsModel(home,away);
 return {pick,probabilities:p?{home:p.home,draw:p.draw,away:p.away}:null,goals,confidence:p?.confidence||'brak modelu',sampleHome:p?.sampleHome||home?.matches||0,sampleAway:p?.sampleAway||away?.matches||0,home:stats(home),away:stats(away),rationale,warning:!home||!away||home.matches<3||away.matches<3?'Próbka danych jest ograniczona. Nie traktuj tego jako pewnego typu.':'Wskazanie statystyczne, nie gwarancja wyniku.'};
}
export async function analyzeMatch(matchId,extra={}){
 const model=process.env.OLLAMA_MODEL||'qwen3:0.6b',forceRefresh=extra.forceRefresh===true;
 const cacheKey='analysis:v11:'+String(matchId)+':'+model;
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
 let report,mode='statistics-only',provider=null,usedModel=null,llmNotice=providerNotice;
 if(process.env.ABACUS_API_KEY){
  try{const abacus=await askAbacusAI(compact);report=abacus.answer;mode='abacus-ai';provider='Abacus.AI';usedModel=abacus.model;}
  catch(error){
   llmNotice=[providerNotice,'Abacus.AI niedostępny: '+error.message].filter(Boolean).join(' ');
   if(process.env.LLM_ENABLED==='true'){
    try{report=await askLocalLLM(compact);mode='local-llm';provider='Ollama';usedModel=model;}
    catch(localError){report=deterministicSummary(evidence);llmNotice+='; Ollama niedostępny: '+localError.message+'. Wyświetlono analizę statystyczną.';}
   }else report=deterministicSummary(evidence);
  }
 }else if(process.env.LLM_ENABLED==='true'){
  try{report=await askLocalLLM(compact);mode='local-llm';provider='Ollama';usedModel=model;}
  catch(error){report=deterministicSummary(evidence);llmNotice=[providerNotice,'Model lokalny niedostępny: '+error.message+'. Wyświetlono analizę statystyczną.'].filter(Boolean).join(' ');}
 }else report=deterministicSummary(evidence);
 const quick=buildQuickReadout(compact);
 const result={mode,provider,model:usedModel,report,quick,llmNotice,cached:false};
 const fixture=match.match||extra.fixture||{},kickoff=fixture.date||fixture.kickoff||fixture.startTime;
 const kickoffMs=Date.parse(kickoff||'');
 const status=String(fixture.status||'NS').toUpperCase();
 if(Number.isFinite(kickoffMs)&&kickoffMs>Date.now()&&!['LIVE','FT','AET','PEN','POSTPONED','CANCELLED'].includes(status)){
  const probabilities=quick.probabilities;
  const goals=quick.goals?.available?quick.goals:null;
  if(probabilities||goals?.available){
   try{await saveForecast({matchId:String(matchId),home:fixture.home?.name||fixture.home?.displayName||'Gospodarze',away:fixture.away?.name||fixture.away?.displayName||'Goście',league:fixture.league||null,kickoff:new Date(kickoffMs).toISOString(),prediction:{probabilities,expectedGoals:goals?{home:goals.lambdaHome,away:goals.lambdaAway}:null,over25:goals?.over25??null,btts:goals?.btts??null,pick:quick.pick?.code||null}});}catch(error){console.error('Forecast history save failed:',error.message);}
  }
 }
 if(mode!=='statistics-only')await writeCache(cacheKey,result,ANALYSIS_CACHE_TTL);
 return result;
}
