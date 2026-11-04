import {getMatchBundle} from './sports.js';
import {getManualStats} from './store.js';
import {readCache,writeCache} from './cache.js';
const ANALYSIS_CACHE_TTL=20*60;
const FORM_MIN_SAMPLE=3;
const systemPrompt='Jesteś analitykiem piłkarskim MatchMind AI. Otrzymujesz dane z ESPN lub SportScore oraz historię ostatnich meczów i raporty absencji. Korzystaj wyłącznie z dostarczonych danych. Oceniaj formę na podstawie ostatnich wyników, bilans bramek, skuteczność u siebie i na wyjeździe, absencje oraz statystyki meczu. Wyraźnie odróżniaj fakty od szacunków. Prawdopodobieństwa MatchMind są orientacyjnym szacunkiem modelu, nie gwarancją. Nie wymyślaj brakujących danych. Zaznacz ograniczenia. Pisz po polsku, zwięźle i używaj nagłówków.';
async function askLocalLLM(evidence){
 if(process.env.LLM_ENABLED!=='true')throw new Error('Lokalny LLM jest wyłączony w konfiguracji.');
 const base=(process.env.OLLAMA_BASE_URL||'http://ollama:11434').replace(/\/$/,'');
 const model=process.env.OLLAMA_MODEL||'qwen3:0.6b';
 const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:false,messages:[{role:'system',content:systemPrompt},{role:'user',content:'/no_think\nPrzygotuj krótki raport analityczny na podstawie danych. Nie przekraczaj 250 słów:\n'+JSON.stringify(evidence)}],options:{temperature:0.2,num_ctx:2048,num_predict:300,num_thread:4},keep_alive:'5m'}),signal:AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS||30000))});
 if(!response.ok)throw new Error('Ollama HTTP '+response.status);
 const data=await response.json();return data.message?.content||'Lokalny model nie zwrócił raportu.';
}
function summarizeForm(form){
 if(!Array.isArray(form)||!form.length)return null;
 const wins=form.filter(x=>x.result==='W').length,draws=form.filter(x=>x.result==='D').length,losses=form.filter(x=>x.result==='L').length;
 const scored=form.reduce((n,x)=>n+x.gf,0),conceded=form.reduce((n,x)=>n+x.ga,0);
 return {matches:form.length,wins,draws,losses,goalsFor:scored,goalsAgainst:conceded,points:wins*3+draws};
}
function deterministicSummary(evidence){
 const m=evidence.match,parts=[];
 const p=m.match?.prediction||m.predictions;
 if(p)parts.push('Szacowane prawdopodobieństwa 1/X/2: '+p.home+'/'+p.draw+'/'+p.away+'% (pewność: '+p.confidence+').');
 const pre=m.match?.preMatch;
 for(const [side,label] of [['home','Gospodarze'],['away','Goście']]){
  const ctx=pre?.[side],f=ctx?.form||[],summary=summarizeForm(f);
  if(summary)parts.push(label+': forma z '+summary.matches+' ostatnich meczów: '+summary.wins+' zwycięstwa, '+summary.draws+' remisy, '+summary.losses+' porażki; bramki '+summary.goalsFor+':'+summary.goalsAgainst+'.'); 
  if(f.length)parts.push(label+' — wyniki: '+f.map(x=>x.result+' '+x.gf+':'+x.ga+' vs '+x.opponent).join(', ')+'.');
  if(ctx?.injuries?.length)parts.push(label+' — absencje: '+ctx.injuries.map(x=>x.name+' ('+x.status+')').join(', ')+'.');
 }
 if(pre?.notices?.length)parts.push('Ograniczenia danych: '+pre.notices.join(' '));
 if(Array.isArray(m.statistics)&&m.statistics.length)parts.push('Statystyki meczowe: '+JSON.stringify(m.statistics).slice(0,2500));
 if(Array.isArray(m.events)&&m.events.length)parts.push('Zdarzenia meczu: '+m.events.length+'.');
 if(Array.isArray(m.lineups)&&m.lineups.length)parts.push('Dostępne są dane składów: '+m.lineups.length+' wpisów.');
 if(Array.isArray(m.injuries)&&m.injuries.length)parts.push('Rekordy absencji: '+m.injuries.length+'.');
 if(evidence.manual.length)parts.push('Dodatkowe ręczne zestawy statystyk: '+JSON.stringify(evidence.manual).slice(0,2000));
 if(!parts.length)parts.push('Brak wystarczających danych do rzetelnej analizy.');
 return parts.join(' ')+' To podsumowanie oparte wyłącznie na dostępnych danych; nie jest gwarancją wyniku.';
}
export async function analyzeMatch(matchId,extra={}){
 const model=process.env.OLLAMA_MODEL||'qwen3:0.6b';
 const cacheKey='analysis:v4:'+String(matchId)+':'+model;
 const cached=await readCache(cacheKey);
 if(cached&&cached.expires>Date.now())return {...cached.data,cached:true};
 let match,providerNotice=null;
 try{match=await getMatchBundle(matchId);}catch(error){
  if(!extra.fixture)throw error;
  providerNotice='SportScore nie udostępnił szczegółów tego meczu ('+error.message+'). Raport wykorzystuje wyłącznie dane terminarza.';
  const f=extra.fixture;
  match={source:'SportScore',match:f,fixture:[],statistics:[],events:[],lineups:[],players:[],injuries:[],predictions:null,live:f.status==='LIVE'};
 }
 const manual=await getManualStats(matchId);
 const evidence={match,manual,additionalContext:extra};
 try{
  const result={mode:'local-llm',provider:'Ollama',model,evidence,report:await askLocalLLM(evidence),llmNotice:providerNotice,cached:false};
  await writeCache(cacheKey,result,ANALYSIS_CACHE_TTL);return result;
 }catch(error){return {mode:'statistics-only',provider:null,evidence,report:deterministicSummary(evidence),llmNotice:[providerNotice,'Lokalny model jest niedostępny: '+error.message].filter(Boolean).join(' '),cached:false};}
}
