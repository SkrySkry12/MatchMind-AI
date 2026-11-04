
const pickedMatches=new Set();
const FILTER_STORAGE_KEY='matchmind:selected-leagues:v1';
function readSavedLeagues(){try{const v=JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY)||'null');return Array.isArray(v)?new Set(v.filter(x=>typeof x==='string')):null;}catch{return null;}}
function saveSelectedLeagues(){try{localStorage.setItem(FILTER_STORAGE_KEY,JSON.stringify([...selectedLeagues]));}catch{}}
let liveRefreshTimer=null,activeModalMatch=null;
function renderMatchOverview(data,m){
 const fixture=data.fixture?.[0],goals=fixture?.goals||{},events=Array.isArray(data.events)?data.events:[];
 const teams=data.statistics||[];
 const statNames=[['Posiadanie piłki','Ball Possession'],['Strzały','Total Shots'],['Strzały celne','Shots on Goal'],['Rzuty rożne','Corner Kicks'],['Faule','Fouls'],['Żółte kartki','Yellow Cards'],['Czerwone kartki','Red Cards'],['Spalone',' offsides']];
 const get=(team,key)=>(team?.statistics||[]).find(v=>String(v.type).toLowerCase()===key.toLowerCase())?.value??'—';
 const statHtml=teams.length?'<div class="mm-team-head"><span>'+safe(teams[0]?.team?.name||m.home.name)+'</span><span>'+safe(teams[1]?.team?.name||m.away.name)+'</span></div><div class="mm-stats">'+statNames.map(([label,key])=>'<div class="mm-stat"><span>'+label+'</span><strong>'+safe(get(teams[0],key))+' <i>·</i> '+safe(get(teams[1],key))+'</strong></div>').join('')+'</div>':'<p class="mm-empty">SportScore nie udostępnia w tym API szczegółowych statystyk dla tego spotkania.</p>';
 const goalsHtml=events.filter(e=>/goal/i.test(String(e.type))||/goal/i.test(String(e.detail))).map(e=>'<div class="mm-event"><b>'+safe(e.time?.elapsed??'?')+'’</b><span>'+safe(e.team?.name||'')+'</span><strong>'+safe(e.player?.name||e.detail||'Gol')+'</strong><small>'+safe(e.detail||'')+'</small></div>').join('');
 const score=goals.home!=null&&goals.away!=null?'<div class="mm-score"><span>'+safe(m.home.name)+'</span><strong>'+goals.home+' : '+goals.away+'</strong><span>'+safe(m.away.name)+'</span></div>':'';
 const status=fixture?.fixture?.status?.long||fixture?.fixture?.status?.short||'Status nieznany';
 const eventsHtml=goalsHtml||'<p class="mm-empty">Brak zdarzeń bramkowych w danych dostawcy.</p>';
 const pre=data.match?.preMatch,pred=data.match?.prediction;
 const formLine=(label,ctx)=>label+': '+(ctx?.form?.length?ctx.form.map(x=>x.result+' '+x.gf+':'+x.ga).join(' · '):'brak danych');
 const absences=(label,ctx)=>ctx?.injuries?.length?'<p><b>'+label+':</b> '+ctx.injuries.map(x=>safe(x.name)+' ('+safe(x.status)+')').join(', ')+'</p>':'';
 const preHtml=pre?'<section><h3>Forma i absencje</h3><p>'+safe(formLine('Gospodarze',pre.home))+'</p><p>'+safe(formLine('Goście',pre.away))+'</p>'+absences('Gospodarze',pre.home)+absences('Goście',pre.away)+(pre.notices?.length?'<p class="mm-empty">'+safe(pre.notices.join(' '))+'</p>':'')+'</section>':'';
 const predHtml=pred?'<section><h3>Szacowane szanse przedmeczowe</h3><div class="mm-stats"><div class="mm-stat"><span>1 · Gospodarze</span><strong>'+pred.home+'%</strong></div><div class="mm-stat"><span>X · Remis</span><strong>'+pred.draw+'%</strong></div><div class="mm-stat"><span>2 · Goście</span><strong>'+pred.away+'%</strong></div></div><p class="mm-empty">Pewność: '+safe(pred.confidence)+' · próbka: '+pred.sampleHome+' / '+pred.sampleAway+' ostatnich meczów. To estymacja statystyczna, nie kurs ani gwarancja.</p></section>':'';
 const body=$('mm-body');
 const report=body.querySelector('#mm-ai-report')?.outerHTML||'<div id="mm-ai-report" class="mm-report">Analiza AI ładuje się niezależnie od statystyk…</div>';
 body.innerHTML='<section><div class="mm-live-row"><h3>Wynik i przebieg</h3><span class="'+(data.live?'mm-live':'')+'">'+safe(status)+(data.live?' · NA ŻYWO':'')+'</span></div>'+score+'</section><section><h3>Statystyki meczu</h3>'+statHtml+'</section><section><h3>Bramki</h3>'+eventsHtml+'</section>'+predHtml+preHtml+'<section><h3>Analiza MatchMind</h3>'+report+'</section>';
}
async function refreshMatchOverview(m){
 const r=await fetch('/api/matches/'+encodeURIComponent(m.id)+'/overview');const d=await r.json();if(!r.ok)throw new Error(d.error||'Nie udało się pobrać danych meczu');
 if(!$('match-modal')||$('match-modal').hidden)return;
 renderMatchOverview(d,m);
 if(d.live){if(liveRefreshTimer)clearInterval(liveRefreshTimer);liveRefreshTimer=setInterval(async()=>{if(!$('match-modal')||$('match-modal').hidden||!activeModalMatch){clearInterval(liveRefreshTimer);liveRefreshTimer=null;return;}try{await refreshMatchOverview(activeModalMatch);}catch(e){}} ,30000);}else if(liveRefreshTimer){clearInterval(liveRefreshTimer);liveRefreshTimer=null;}
}
async function openMatch(m){
 if(!m)return;activeModalMatch=m;
 if(!document.getElementById('match-modal'))document.body.insertAdjacentHTML('beforeend','<div class="match-modal" id="match-modal" hidden><div class="match-modal-shade" data-dismiss></div><section class="match-modal-card"><header><div><p class="eyebrow">MATCHMIND INSIGHT</p><h2 id="mm-title"></h2><p id="mm-meta" class="muted"></p></div><button class="mm-close" data-dismiss>×</button></header><div id="mm-body" class="mm-body">Pobieranie danych…</div></section></div>');
 const modal=$('match-modal');modal.hidden=false;
 $('mm-title').textContent=m.home.name+' — '+m.away.name;$('mm-meta').textContent=m.league+' · '+new Date(m.date).toLocaleString('pl-PL');
 document.querySelectorAll('[data-dismiss]').forEach(x=>x.onclick=()=>{modal.hidden=true;activeModalMatch=null;if(liveRefreshTimer){clearInterval(liveRefreshTimer);liveRefreshTimer=null;}});
 $('mm-body').innerHTML='<div class="loading">Pobieram wynik, statystyki i zdarzenia…</div><section><h3>Analiza MatchMind</h3><div id="mm-ai-report" class="mm-report">Przygotowuję raport AI…</div></section>';
 refreshMatchOverview(m).catch(e=>{if(activeModalMatch?.id!==m.id||$('match-modal')?.hidden)return;const previousReport=$('mm-ai-report')?.textContent||'Przygotowuję analizę na podstawie terminarza…';$('mm-body').innerHTML='<section><div class="mm-live-row"><h3>Szczegóły meczu</h3><span>Ograniczone dane</span></div><p class="mm-empty">SportScore nie zwrócił szczegółów spotkania: '+safe(e.message)+'. Raport poniżej spróbuje wykorzystać dane z terminarza.</p></section><section><h3>Analiza MatchMind</h3><div id="mm-ai-report" class="mm-report">Przygotowuję analizę na podstawie terminarza…</div></section>';$('mm-ai-report').textContent=previousReport;});
 fetch('/api/matches/'+encodeURIComponent(m.id)+'/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fixture:m,forceRefresh:true}),signal:AbortSignal.timeout(55000)}).then(r=>r.json()).then(a=>{
  if(!$('match-modal')||$('match-modal').hidden||activeModalMatch?.id!==m.id)return;
  const target=$('mm-ai-report');if(target){target.textContent=(a.report||a.error||'Brak raportu')+(a.llmNotice?'\n\nInformacja: '+a.llmNotice:'');target.insertAdjacentHTML('beforebegin','<p class="mm-cache-note">'+(a.cached?'Raport z cache':a.provider==='Abacus.AI'?'Raport wygenerowany przez Abacus.AI':a.provider==='Ollama'?'Raport wygenerowany przez Ollama':'Podsumowanie dostępnych danych')+'</p>');}
 }).catch(e=>{const target=$('mm-ai-report');if(target)target.textContent='Analiza niedostępna: '+e.message;});
}
function providerBadge(data){const p=data?.provider||'Tylko statystyki';const label=p==='Abacus.AI'?'Abacus.AI':p==='Ollama'?'Ollama':'Analiza statystyczna';return '<span class="mm-provider-badge">Silnik: '+safe(label)+(data?.model?' · '+safe(data.model):'')+'</span>';}
function quickStatsHtml(label,stats){
 if(!stats)return '<div class="mm-quick-team"><b>'+label+'</b><span>Brak wystarczających danych</span></div>';
 const windowLine=(name,w)=>w?'<span>'+name+': '+w.pointsPerMatch+' pkt/mecz · '+w.wins+'W '+w.draws+'R '+w.losses+'P · gole '+w.goalsFor+':'+w.goalsAgainst+'</span>':'';return '<div class="mm-quick-team"><b>'+label+'</b><span>'+stats.matches+' meczów · '+stats.record+'</span><span>Punkty/mecz: <b>'+stats.pointsPerMatch+'</b> · gole: <b>'+stats.goals+'</b></span>'+windowLine('Ostatnie 5',stats.last5)+windowLine('Ostatnie 10',stats.last10)+'<span>Trend 5 vs poprzednie 5: <b>'+safe(stats.trend)+'</b>'+(stats.trendDelta!==null?' ('+safe(stats.trendDelta)+' pkt/mecz)':'')+'</span><span>Seria: '+(stats.streak?.matches||0)+' × '+safe(({W:'wygrane',D:'remisy',L:'porażki'}[stats.streak?.result]||'—'))+'</span><span>Śr. gole: '+stats.goalsForPerMatch+' strzelone / '+stats.goalsAgainstPerMatch+' stracone</span><span>Czyste konta: '+stats.cleanSheets+' · bez gola: '+stats.failedToScore+'</span><span>BTTS: '+stats.btts+' · over 2.5: '+stats.over25+'</span><span>U siebie: '+(stats.home?stats.home.pointsPerMatch+' pkt/mecz':'brak danych')+' · wyjazd: '+(stats.away?stats.away.pointsPerMatch+' pkt/mecz':'brak danych')+'</span></div>';
}
function couponMatchHtml(r,i){
 const name='<b>'+(i+1)+'. '+safe(r.m.home?.name)+' — '+safe(r.m.away?.name)+'</b>';
 if(r.error)return '<article class="mm-pick">'+name+'<p class="mm-warning">Nie udało się ocenić: '+safe(r.error)+'</p></article>';
 const q=r.data.quick;
 if(!q)return '<article class="mm-pick">'+name+'<p class="mm-warning">Brak podsumowania statystycznego.</p></article>';
 const probsForRisk=q.probabilities?[q.probabilities.home,q.probabilities.draw,q.probabilities.away].map(Number).filter(Number.isFinite):[];
 const ranked=[...probsForRisk].sort((a,b)=>b-a),top=ranked[0]??0,margin=ranked.length>1?top-ranked[1]:0;
 const sample=Math.min(Number(q.home?.matches)||0,Number(q.away?.matches)||0);
 const risk=sample<3||!probsForRisk.length||top<45||margin<5?'Wysokie':top<58||margin<12||sample<5?'Umiarkowane':'Niższe';
 const riskClass=risk==='Wysokie'?'high':risk==='Umiarkowane'?'medium':'low';
 const riskReason=sample<3?'Mała próbka danych':!probsForRisk.length?'Brak prawdopodobieństw 1X2':top<45?'Brak wyraźnego faworyta':margin<5?'Bardzo mała różnica między typami':sample<5?'Ograniczona liczba meczów w próbce':'Wyraźniejszy sygnał statystyczny';
 const pick=q.pick?'<div class="mm-quick-pick"><small>NAJMOCNIEJSZE WSKAZANIE STATYSTYCZNE</small><strong>'+safe(q.pick.code)+' · '+safe(q.pick.label)+'</strong>'+(q.pick.probability!==null?' <span>'+safe(q.pick.probability)+'%</span>':'')+'<p>'+safe(q.rationale.join(' '))+'</p></div>':'<div class="mm-quick-pick"><strong>Brak podstaw do wskazania typu</strong><p>Za mało danych albo brak modelowych prawdopodobieństw.</p></div>';
 const probs=q.probabilities?'<div class="mm-quick-probs"><span>1: '+q.probabilities.home+'%</span><span>X: '+q.probabilities.draw+'%</span><span>2: '+q.probabilities.away+'%</span></div>':'';
 const g=q.goals;
 const goalsHtml=g?.available?'<div class="mm-goals"><div class="mm-goals-head"><strong>Przewidywana liczba goli</strong><span>Model Poissona</span></div><div class="mm-goals-lambdas"><div><small>'+safe(r.m.home?.name||'Gospodarze')+'</small><b>'+g.lambdaHome.toFixed(2)+'</b><small>oczekiwane gole</small></div><div class="mm-goals-total"><small>Łącznie</small><b>'+g.lambdaTotal.toFixed(2)+'</b><small>gola</small></div><div><small>'+safe(r.m.away?.name||'Goście')+'</small><b>'+g.lambdaAway.toFixed(2)+'</b><small>oczekiwane gole</small></div></div><div class="mm-goals-markets"><span>Over 1.5 <b>'+g.over15+'%</b></span><span>Over 2.5 <b>'+g.over25+'%</b></span><span>Over 3.5 <b>'+g.over35+'%</b></span><span>Obie strzelą <b>'+g.btts+'%</b></span></div><p>Najbardziej prawdopodobny wynik: <b>'+g.mostLikelyScore+'</b> ('+g.scoreProbability+'%)</p><small>Próba: '+g.sampleHome+' / '+g.sampleAway+' meczów. '+safe(g.method)+'.</small></div>':'<div class="mm-goals mm-goals-missing">Szacowanie goli niedostępne: '+safe(g?.reason||'brak wystarczających danych')+'</div>';
 return '<article class="mm-pick">'+name+providerBadge(r.data)+'<div class="mm-risk '+riskClass+'"><strong>Ryzyko: '+risk+'</strong><span>'+riskReason+'</span></div>'+pick+probs+goalsHtml+'<div class="mm-compare-title">Porównanie statystyk</div><div class="mm-quick-grid">'+quickStatsHtml(r.m.home?.name||'Gospodarze',q.home)+quickStatsHtml(r.m.away?.name||'Goście',q.away)+'</div><p class="mm-warning">'+safe(q.warning)+'</p></article>';
}
function renderCouponPicker(){
 const host=$('coupon-match-picker');if(!host)return;
 const list=allMatches.filter(m=>selectedLeagues===null||selectedLeagues.has(m.league));
 if(!list.length){host.innerHTML='<p class="muted">Brak spotkań dla wybranej daty. Zmień dzień w zakładce Mecze i wróć tutaj.</p>';return;}
 host.innerHTML=list.map(m=>'<label class="coupon-match-option"><input type="checkbox" data-coupon-pick="'+safe(m.id)+'" '+(pickedMatches.has(String(m.id))?'checked':'')+'><span><b>'+safe(m.home.name)+' — '+safe(m.away.name)+'</b><small>'+safe(m.league)+' · '+new Date(m.date).toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</small></span><span class="coupon-match-status">'+safe(m.status||'Nadchodzący')+'</span></label>').join('');
 host.querySelectorAll('[data-coupon-pick]').forEach(input=>input.onchange=()=>{input.checked?pickedMatches.add(input.dataset.couponPick):pickedMatches.delete(input.dataset.couponPick);updateCouponCount();});
 updateCouponCount();
}
function updateCouponCount(){
 const count=pickedMatches.size;
 if($('coupon-picked-count'))$('coupon-picked-count').textContent=count+' wybranych';
 if($('coupon-generate'))$('coupon-generate').disabled=count===0;
}
function addBuilder(){
 renderCouponPicker();
 document.querySelectorAll('[data-coupon-mode]').forEach(button=>button.onclick=()=>{
  const consult=button.dataset.couponMode==='consult';
  document.querySelectorAll('[data-coupon-mode]').forEach(x=>x.classList.toggle('active',x===button));
  $('coupon-generate-panel').hidden=consult;$('coupon-consult-panel').hidden=!consult;$('coupon-builder-result').hidden=true;
 });
 const out=$('coupon-builder-result');
 async function runCoupon(matches,customLines=[]){
  const button=customLines.length?$('coupon-consult'):$('coupon-generate');
  if(button.dataset.running==='1'||!matches.length)return;
  button.dataset.running='1';button.disabled=true;button.textContent='Analizuję kupon…';out.hidden=false;
  out.innerHTML='<h3>Analiza wybranych zdarzeń</h3><p class="muted">Sprawdzam dostępne dane dla '+matches.length+' spotkań.</p>';
  try{
   const results=await Promise.all(matches.map(async m=>{
    try{const response=await fetch('/api/coupons/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fixture:m,forceRefresh:true}),signal:AbortSignal.timeout(55000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Błąd analizy');return {m,data};}
    catch(error){return {m,error:error?.message||'Nieznany błąd'};}
   }));
   const profile=$('coupon-risk')?.value||'balanced',market=$('coupon-market')?.value||'all';
   const annotated=results.map((r,i)=>({...r,custom:customLines[i]||null,profile,market}));
   out.innerHTML='<div class="coupon-result-head"><div><p class="eyebrow">MATCHMIND ANALYSIS</p><h3>'+(customLines.length?'Ocena Twojego kuponu':'Propozycja MatchMind AI')+'</h3></div><span>'+results.length+' zdarzeń</span></div>'+annotated.map((r,i)=>couponMatchHtml(r,i)).join('')+'<p class="coupon-note">Kursy nie są pobierane automatycznie. Wprowadzone kursy są danymi użytkownika i nie są przez MatchMind weryfikowane.</p>';
  }catch(error){out.innerHTML='<p class="mm-warning">'+safe(error?.message||'Nie udało się przeanalizować kuponu.')+'</p>';}
  finally{button.dataset.running='0';button.disabled=false;button.textContent=customLines.length?'Przeanalizuj mój kupon →':'Utwórz propozycję ponownie →';}
 }
 $('coupon-generate')?.addEventListener('click',()=>{
  const count=Number($('coupon-count').value)||3,chosen=allMatches.filter(m=>pickedMatches.has(String(m.id))).slice(0,count);
  if(chosen.length)runCoupon(chosen);
 });
 $('coupon-consult')?.addEventListener('click',()=>{
  const lines=$('coupon-own-slip').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),matches=[],custom=[],missing=[];
  for(const line of lines){
   const parts=line.split('|').map(x=>x.trim()),fixtureText=parts[0]||'',teams=fixtureText.split(/\s+-\s+/);
   const match=allMatches.find(m=>teams.length>=2&&m.home.name.toLocaleLowerCase('pl').includes(teams[0].toLocaleLowerCase('pl'))&&m.away.name.toLocaleLowerCase('pl').includes(teams[1].toLocaleLowerCase('pl')));
   if(!match){missing.push(line);continue;}
   matches.push(match);custom.push({market:parts[1]||'Nie podano',odds:parts[2]||null});
  }
  if(missing.length){out.hidden=false;out.innerHTML='<h3>Nie rozpoznano wszystkich pozycji</h3><p class="coupon-note">Popraw nazwy drużyn tak, aby odpowiadały terminarzowi:</p><ul>'+missing.map(x=>'<li>'+safe(x)+'</li>').join('')+'</ul>';}
  if(matches.length)runCoupon(matches,custom);
  else if(!missing.length){out.hidden=false;out.innerHTML='<p class="coupon-note">Wpisz przynajmniej jedno zdarzenie w osobnym wierszu.</p>';}
 });
}
function performanceMetric(value,digits=2){return value==null?'—':Number(value).toFixed(digits).replace('.',',');}
function renderPerformance(data){
 const k=$('performance-kpis'),acc=data.accuracy;
 const cards=[
  ['TRAFNOŚĆ 1X2',acc?acc.rate+'%':'—',acc?acc.hit+' z '+acc.total+' trafień':'Brak rozliczonych prognoz'],
  ['BRIER SCORE',performanceMetric(data.brier,4),data.brier==null?'Wymaga danych':'Niżej oznacza lepiej · zakres 0–0,667'],
  ['BŁĄD GOLI (MAE)',performanceMetric(data.expectedGoalsMae,3),data.expectedGoalsMae==null?'Brak prognoz xG do oceny':'Średni błąd w golach na drużynę'],
  ['PRÓBKA',String(data.settled||0),(data.pending||0)+' oczekujących · '+(data.total||0)+' zapisanych']
 ];
 k.innerHTML=cards.map(x=>'<article><span>'+x[0]+'</span><strong>'+x[1]+'</strong><small>'+x[2]+'</small></article>').join('');
 $('performance-storage').textContent='Zapis: '+(data.storage||'nieznany');
 const bins=data.calibration||[];
 $('performance-calibration').innerHTML=bins.some(x=>x.count)?'<div class="calibration-legend"><span>Przedział pewności</span><span>Model / trafność</span></div>'+bins.map(x=>'<div class="calibration-row"><div class="calibration-range">'+safe(x.range)+'<small>'+x.count+' prognoz</small></div><div class="calibration-bars">'+(x.confidence==null?'<span class="muted">—</span>':'<div class="calibration-track"><i style="width:'+Math.max(0,Math.min(100,x.confidence))+'%"></i></div><div class="calibration-track actual"><i style="width:'+Math.max(0,Math.min(100,x.accuracy||0))+'%"></i></div>')+'</div><strong>'+(x.accuracy==null?'—':x.accuracy+'%')+'</strong></div>').join('')+'<div class="calibration-key"><span><i></i> Średnia pewność</span><span><i></i> Rzeczywista trafność</span></div>':'<div class="performance-empty">Za mało rozliczonych prognoz, aby ocenić kalibrację. Dane pojawią się po zakończeniu i zweryfikowaniu pierwszych spotkań.</div>';
 const quality=[['Log loss',performanceMetric(data.logLoss,4),'Niżej = lepiej'],['Over 2.5',data.over25?data.over25.rate+'%':'—',data.over25?data.over25.hit+' / '+data.over25.total+' trafień':'Brak ocenionych prognoz'],['Obie strzelą (BTTS)',data.btts?data.btts.rate+'%':'—',data.btts?data.btts.hit+' / '+data.btts.total+' trafień':'Brak ocenionych prognoz']];
 $('performance-quality').innerHTML=quality.map(x=>'<div class="quality-item"><span>'+x[0]+'</span><strong>'+x[1]+'</strong><small>'+x[2]+'</small></div>').join('');
 const rows=data.history||[];
 $('performance-history-list').innerHTML=rows.length?'<div class="history-table-wrap"><table class="history-table"><thead><tr><th>Mecz</th><th>Termin</th><th>Prognoza</th><th>Wynik</th><th>Status</th></tr></thead><tbody>'+rows.slice(0,15).map(x=>{const p=x.prediction||{},probs=p.probabilities;const pred=probs?['1','X','2'][['home','draw','away'].map(z=>Number(probs[z])||0).indexOf(Math.max(Number(probs.home)||0,Number(probs.draw)||0,Number(probs.away)||0))]:'xG '+(p.expectedGoals?.home??'—')+' : '+(p.expectedGoals?.away??'—');return '<tr><td><b>'+safe(x.home)+' — '+safe(x.away)+'</b><small>'+safe(x.league||'')+'</small></td><td>'+new Date(x.kickoff).toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</td><td>'+safe(pred)+'</td><td>'+(x.status==='settled'?x.actualHome+' : '+x.actualAway:'—')+'</td><td><span class="history-status '+(x.status==='settled'?'done':'waiting')+'">'+(x.status==='settled'?'Rozliczony':'Oczekuje')+'</span></td></tr>';}).join('')+'</tbody></table></div>':'<div class="performance-empty">Nie ma jeszcze zapisanych prognoz. Otwórz analizę nadchodzącego meczu – MatchMind zapisze przedmeczową prognozę automatycznie.</div>';
}
async function loadPerformance(){
 const k=$('performance-kpis');if(!k)return;
 const button=$('performance-refresh');if(button){button.disabled=true;button.textContent='Aktualizuję…';}
 try{const response=await fetch('/api/performance',{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'Błąd pobierania danych');renderPerformance(data);}
 catch(error){$('performance-calibration').innerHTML='<p class="performance-empty">Nie udało się pobrać historii: '+safe(error.message)+'</p>';}
 finally{if(button){button.disabled=false;button.textContent='Odśwież dane ↻';}}
}

const matchesEl=document.querySelector('#matches'),$=id=>document.getElementById(id);let allMatches=[],selectedLeagues=readSavedLeagues(),leagueNames=[];const now=new Date();$('match-date').value=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');function safe(t){return String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}async function refreshStatus(){try{const d=await(await fetch('/api/health')).json(),f=d.footballApi||{};$('api-status').textContent=f.provider||'SportScore';$('api-remaining').textContent=f.provider||'SportScore';$('cache-hits').textContent=(f.cacheHits||0).toLocaleString('pl-PL');$('cache-detail').textContent=(f.cacheEntries||0)+' wpisów · '+(f.storage||'cache')+' · '+(f.limit||'');$('llm-status').textContent=d.llm?.enabled?'Aktywny':'Wkrótce';$('llm-model').textContent=d.llm?.model||'Ollama';}catch{$('api-status').textContent='Offline';}}function predictionMarkup(p){if(!p||p.home==null)return '<div class="no-prediction">Brak wystarczających danych do oszacowania</div>';const v=[p.home,p.draw,p.away],n=['1','X','2'],b=v.indexOf(Math.max(...v));return '<div class="prediction-title">SZACOWANE SZANSE · '+safe(p.source)+'</div><div class="prob-bars">'+v.map((x,i)=>'<span class="'+(i===b?'best':'')+'" style="width:'+Math.max(0,Math.min(100,x))+'%"></span>').join('')+'</div><div class="prob-labels">'+v.map((x,i)=>'<span>'+(i===b?'<b>':'')+n[i]+' '+Math.round(x)+'%'+(i===b?'</b>':'')+'</span>').join('')+'</div><div class="confidence">Największa szansa: '+(b===0?'gospodarze':b===1?'remis':'goście')+' · '+Math.round(v[b])+'% · pewność: '+safe(p.confidence||'nieznana')+'</div>';}function polishLeague(name){const key=String(name||'').trim().toLocaleLowerCase('en');const map={'uefa champions league':'Liga Mistrzów','champions league':'Liga Mistrzów','uefa europa league':'Liga Europy','europa league':'Liga Europy','uefa conference league':'Liga Konferencji Europy','conference league':'Liga Konferencji Europy','premier league':'Premier League','laliga':'La Liga','la liga':'La Liga','serie a':'Serie A','serie b':'Serie B','bundesliga':'Bundesliga','2. bundesliga':'2. Bundesliga','ligue 1':'Ligue 1','ligue 2':'Ligue 2','eredivisie':'Eredivisie','primeira liga':'Liga Portugalska','liga portugal':'Liga Portugalska','ekstraklasa':'Ekstraklasa','fa cup':'Puchar Anglii','copa del rey':'Puchar Króla','coppa italia':'Puchar Włoch','dfb pokal':'Puchar Niemiec','supercopa de espana':'Superpuchar Hiszpanii','uefa nations league':'Liga Narodów UEFA','world cup':'Mistrzostwa Świata','fifa world cup':'Mistrzostwa Świata'};return map[key]||name;}function polishCountry(name){const map={'England':'Anglia','Spain':'Hiszpania','Germany':'Niemcy','Italy':'Włochy','France':'Francja','Portugal':'Portugalia','Netherlands':'Holandia','Poland':'Polska','Scotland':'Szkocja','Turkey':'Turcja','Saudi Arabia':'Arabia Saudyjska','World':'Międzynarodowe'};return map[name]||name||'Rozgrywki';}function renderFilters(){leagueNames=[...new Set(allMatches.map(m=>m.league).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pl'));if(selectedLeagues===null)selectedLeagues=new Set(leagueNames);const all=leagueNames.every(n=>selectedLeagues.has(n));const nav=$('league-filters');nav.innerHTML='<div class="league-picker"><button type="button" class="league-picker-trigger" id="league-picker-trigger" aria-expanded="false"><span class="picker-icon">☷</span><span>Wybierz ligi</span><strong>'+leagueNames.filter(n=>selectedLeagues.has(n)).length+' / '+leagueNames.length+'</strong><span class="picker-chevron">⌄</span></button><div class="league-picker-menu" id="league-picker-menu" hidden><div class="picker-menu-head"><span>Widoczne rozgrywki</span><div><button type="button" id="select-all-leagues">Wszystkie</button><button type="button" id="clear-leagues">Wyczyść</button></div></div><div class="league-check-list">'+leagueNames.map((n,i)=>'<label class="league-check"><input type="checkbox" value="'+safe(n)+'" '+(selectedLeagues.has(n)?'checked':'')+'><span>'+safe(n)+'</span></label>').join('')+'</div></div></div><span class="filter-summary">'+(all?'Wyświetlasz wszystkie ligi':selectedLeagues.size?'Wyświetlasz wybrane ligi':'Nie wybrano żadnej ligi')+'</span>';const trigger=$('league-picker-trigger'),menu=$('league-picker-menu');trigger.onclick=()=>{menu.hidden=!menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden));};nav.querySelectorAll('input[type=checkbox]').forEach(input=>input.onchange=()=>{input.checked?selectedLeagues.add(input.value):selectedLeagues.delete(input.value);saveSelectedLeagues();renderFilters();renderMatches();$('league-picker-menu').hidden=false;$('league-picker-trigger').setAttribute('aria-expanded','true');});$('select-all-leagues').onclick=()=>{selectedLeagues=new Set([...selectedLeagues,...leagueNames]);saveSelectedLeagues();renderFilters();renderMatches();$('league-picker-menu').hidden=false;$('league-picker-trigger').setAttribute('aria-expanded','true');};$('clear-leagues').onclick=()=>{selectedLeagues.clear();saveSelectedLeagues();renderFilters();renderMatches();$('league-picker-menu').hidden=false;$('league-picker-trigger').setAttribute('aria-expanded','true');};} function renderMatches(){const q=$('search').value.trim().toLocaleLowerCase('pl-PL'),list=allMatches.filter(m=>selectedLeagues.has(m.league)&&[m.home.name,m.away.name,m.league,m.country].join(' ').toLocaleLowerCase('pl-PL').includes(q));if(!list.length){matchesEl.innerHTML='<div class="empty-state">Nie znaleziono spotkań. Zmień datę lub wyszukiwaną frazę.</div>';return;}const leagues=new Map();list.forEach(m=>{if(!leagues.has(m.league))leagues.set(m.league,[]);leagues.get(m.league).push(m);});matchesEl.innerHTML=[...leagues.entries()].sort((a,b)=>a[0].localeCompare(b[0],'pl')).map(([league,items])=>{const times=new Map();items.forEach(m=>{const t=new Date(m.date).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'});if(!times.has(t))times.set(t,[]);times.get(t).push(m);});return '<section class="league-group"><div class="group-head"><div><div class="league-name">'+safe(league)+'</div><div class="league-meta">'+safe(items[0].country||'Rozgrywki')+' · '+items.length+' spotkań</div></div><div class="group-count">'+safe(items[0].round||'TERMINARZ')+'</div></div>'+[...times.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([time,ms])=>'<div class="time-block"><div class="time-label">'+time+'</div>'+ms.map(m=>'<article class="match"><label class="mm-check"><input type="checkbox" data-pick="'+safe(m.id)+'" '+(pickedMatches.has(String(m.id))?'checked':'')+'><span></span></label><div><div class="kickoff">'+time+'</div><div class="match-status">'+safe(m.status)+'</div></div><div class="teams"><div class="team">'+(m.home.logo?'<img src="'+safe(m.home.logo)+'" alt="">':'')+'<span class="team-name">'+safe(m.home.name)+'</span></div><div class="team">'+(m.away.logo?'<img src="'+safe(m.away.logo)+'" alt="">':'')+'<span class="team-name">'+safe(m.away.name)+'</span></div></div><div class="prediction">'+predictionMarkup(m.prediction)+'</div><div class="match-actions"><button data-id="'+safe(m.id)+'">Analizuj</button></div></article>').join('')+'</div>').join('')+'</section>';}).join('');matchesEl.querySelectorAll('input[data-pick]').forEach(x=>x.onchange=()=>{x.checked?pickedMatches.add(x.dataset.pick):pickedMatches.delete(x.dataset.pick);updateCouponCount();});matchesEl.querySelectorAll('button[data-id]').forEach(b=>b.onclick=()=>openMatch(allMatches.find(m=>m.id===b.dataset.id)));}async function load(){matchesEl.innerHTML='<div class="loading">Pobieranie spotkań z SportScore…</div>';try{const r=await fetch('/api/fixtures?date='+encodeURIComponent($('match-date').value)),d=await r.json();if(!r.ok)throw new Error(d.error||'Błąd API');allMatches=(d.fixtures||[]).map(m=>({...m,league:polishLeague(m.league),country:polishCountry(m.country)}));renderFilters();renderMatches();if(d.notice){matchesEl.insertAdjacentHTML('afterbegin','<p class="mm-warning">'+safe(d.notice)+'</p>');}await refreshStatus();}catch(e){matchesEl.innerHTML='<div class="empty-state">Nie udało się pobrać terminarza: '+safe(e.message)+'</div>';}}$('refresh').onclick=load;$('match-date').onchange=load;$('search').oninput=renderMatches;function switchMainTab(tab){
 const performance=tab==='performance';
 $('performance').hidden=!performance;
 $('matches-workspace').hidden=performance;
 document.querySelectorAll('.main-tab').forEach(button=>{const active=button.dataset.tab===tab;button.classList.toggle('active',active);button.setAttribute('aria-current',active?'page':'false');});
 if(performance)loadPerformance();
}
document.querySelectorAll('.main-tab').forEach(button=>button.addEventListener('click',()=>switchMainTab(button.dataset.tab)));\naddBuilder();
$('performance-refresh')?.addEventListener('click',loadPerformance);
load();refreshStatus();if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});