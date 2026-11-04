import {getMatchBundle} from './sports.js';
import {getManualStats} from './store.js';
const systemPrompt='Jesteś analitykiem danych piłkarskich MatchMind AI. Otrzymujesz obiekt JSON z danymi z API. Analizuj wyłącznie dostarczone informacje. Nie wymyślaj statystyk, składów, kontuzji ani prawdopodobieństw. Jeśli danych brakuje, napisz to wprost. Oddziel fakty od interpretacji. Nie udzielaj porad bukmacherskich. Odpowiadaj po polsku, zwięźle i profesjonalnie.';
async function askLocalLLM(evidence){
 const base=(process.env.OLLAMA_BASE_URL||'http://ollama:11434').replace(/\/$/,'');
 const model=process.env.OLLAMA_MODEL||'qwen3:4b';
 const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:false,messages:[{role:'system',content:systemPrompt},{role:'user',content:'Przygotuj raport analityczny na podstawie danych:\n'+JSON.stringify(evidence)}],options:{temperature:0.2,num_ctx:8192}}),signal:AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS||90000))});
 if(!response.ok)throw new Error('Ollama HTTP '+response.status);
 const data=await response.json();return data.message?.content||'Lokalny model nie zwrócił raportu.';
}
function deterministicSummary(evidence){
 const parts=[];
 const stats=evidence.match.statistics;
 if(Array.isArray(stats)&&stats.length)parts.push('Dostępne są statystyki meczowe dla '+stats.length+' zespołów.');
 if(Array.isArray(evidence.match.events))parts.push('Zdarzenia meczowe: '+evidence.match.events.length+'.');
 if(Array.isArray(evidence.match.lineups))parts.push('Rekordy składów: '+evidence.match.lineups.length+'.');
 if(evidence.manual.length)parts.push('Uwzględniono '+evidence.manual.length+' ręcznie dodanych zestawów statystyk.');
 if(!parts.length)parts.push('Brak wystarczających danych do rzetelnej analizy.');
 return parts.join(' ')+' To podsumowanie techniczne, nie prognoza wyniku. Uzupełnij dane, gdy API udostępni brakujące informacje.';
}
export async function analyzeMatch(matchId,extra={}){
 const [match,manual]=await Promise.all([getMatchBundle(matchId),getManualStats(matchId)]);
 const evidence={match,manual,additionalContext:extra};
 try{return {mode:'local-llm',provider:'Ollama',model:process.env.OLLAMA_MODEL||'qwen3:4b',evidence,report:await askLocalLLM(evidence)};}
 catch(error){return {mode:'statistics-only',provider:null,evidence,report:deterministicSummary(evidence),llmNotice:'Lokalny model jest niedostępny: '+error.message};}
}
