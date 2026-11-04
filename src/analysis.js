import {getMatchBundle} from './sports.js';
import {getManualStats} from './store.js';
import {readCache,writeCache} from './cache.js';
const ANALYSIS_CACHE_TTL=6*60*60;
const systemPrompt='Jesteś analitykiem danych piłkarskich MatchMind AI. Otrzymujesz obiekt JSON z danych meczowych SportScore. Analizuj wyłącznie dostarczone informacje. Nie wymyślaj statystyk, składów, kontuzji ani prawdopodobieństw. Jeśli danych brakuje, napisz to wprost. Oddziel fakty od interpretacji. Nie udzielaj porad bukmacherskich. Odpowiadaj po polsku, zwięźle, profesjonalnie i używaj nagłówków.';
async function askLocalLLM(evidence){
 if(process.env.LLM_ENABLED!=='true')throw new Error('Lokalny LLM jest wyłączony w konfiguracji.');
 const base=(process.env.OLLAMA_BASE_URL||'http://ollama:11434').replace(/\/$/,'');
 const model=process.env.OLLAMA_MODEL||'qwen3:0.6b';
 const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:false,messages:[{role:'system',content:systemPrompt},{role:'user',content:'/no_think\nPrzygotuj krótki raport analityczny na podstawie danych. Nie przekraczaj 350 słów:\n'+JSON.stringify(evidence)}],options:{temperature:0.2,num_ctx:2048,num_predict:450,num_thread:4},keep_alive:'5m'}),signal:AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS||45000))});
 if(!response.ok)throw new Error('Ollama HTTP '+response.status);
 const data=await response.json();return data.message?.content||'Lokalny model nie zwrócił raportu.';
}
function deterministicSummary(evidence){
 const m=evidence.match,parts=[];
 if(Array.isArray(m.statistics)&&m.statistics.length)parts.push('Dostępne są statystyki meczowe dla '+m.statistics.length+' zespołów.');
 if(Array.isArray(m.events))parts.push('Zdarzenia meczowe: '+m.events.length+'.');
 if(Array.isArray(m.lineups))parts.push('Rekordy składów: '+m.lineups.length+'.');
 if(Array.isArray(m.injuries))parts.push('Rekordy dotyczące absencji: '+m.injuries.length+'.');
 if(evidence.manual.length)parts.push('Uwzględniono '+evidence.manual.length+' ręcznie dodanych zestawów statystyk.');
 if(!parts.length)parts.push('Brak wystarczających danych do rzetelnej analizy.');
 return parts.join(' ')+' To podsumowanie techniczne, nie prognoza wyniku. Brakujące dane nie są uzupełniane domysłami.';
}
export async function analyzeMatch(matchId,extra={}){
 const model=process.env.OLLAMA_MODEL||'qwen3:0.6b';
 const cacheKey='analysis:v2:'+String(matchId)+':'+model;
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
