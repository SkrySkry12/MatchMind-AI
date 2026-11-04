import OpenAI from 'openai';
import {getFixtureStats} from './sports.js';
import {getManualStats} from './store.js';
export async function analyzeMatch(matchId, extra={}) {
 const provider=await getFixtureStats(matchId); const manual=await getManualStats(matchId);
 const evidence={provider,manual,additionalContext:extra};
 if(!process.env.OPENAI_API_KEY)return {mode:'rules-only',evidence,report:'Nie skonfigurowano OPENAI_API_KEY. Dodaj klucz po stronie serwera, aby otrzymać opisową analizę AI.',limitations:['Analiza nie jest prognozą wyniku.','Dane demo nie odzwierciedlają aktualnej formy drużyn.']};
 const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
 const response=await client.chat.completions.create({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',temperature:0.2,messages:[{role:'system',content:'Jesteś analitykiem danych piłkarskich. Analizuj wyłącznie dostarczone dane. Nie wymyślaj statystyk ani prawdopodobieństw. Wskaż braki danych, ograniczenia próby i niepewność. Nie udzielaj porad bukmacherskich.'},{role:'user',content:JSON.stringify(evidence)}]});
 return {mode:'ai',evidence,report:response.choices[0]?.message?.content||'Brak raportu'};
}
