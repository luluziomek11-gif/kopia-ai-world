import '@fontsource/dm-sans/latin-ext-400.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-ext-600.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/fraunces/latin-ext-400.css';
import '@fontsource/fraunces/latin-400.css';
import './style.css';
import { createWorldGame } from './scene';
import { WorldConnection } from './connection';
import { distance, canSee, INTERACTION_DISTANCE, roomAt } from '../shared/room';
import type { ClientMessage, WorldState } from '../shared/types';
import { addressedResident } from '../shared/conversation';

const icons: Record<string, string> = {
  play: '<path d="m8 5 11 7-11 7Z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  save: '<path d="M5 3h12l4 4v14H3V3h2Zm2 0v7h10V3M7 21v-7h10v7"/>',
  resume: '<path d="M3 10a9 9 0 1 1 1 8M3 4v6h6"/>', full: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  leaf: '<path d="M20 3c-8 0-16 1-16 10a7 7 0 0 0 14 0c0-4 2-10 2-10ZM3 21 14 10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  book: '<path d="M12 6c-3-3-7-3-10-2v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2Zm0 0v15"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  sliders: '<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.leaf}</svg>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const time = (n: number) => new Intl.DateTimeFormat('pl', { hour:'2-digit', minute:'2-digit' }).format(n);
const actionLabels: Record<string, string> = {work:'Czas na mały projekt',rest:'Chwila na kanapie',sleep:'Odpoczynek w sypialni',plants:'Wśród zieleni',wander:'Mały spacer po domu',observe:'Obserwacja otoczenia',plan:'Nowa strategia',project:'Fikcyjny projekt',talk:'Rozmowa z mieszkańcem'};
const activityLabels: Record<string, string> = {idle:'Obserwuje otoczenie',walking:'Spaceruje po domu',working:'Pracuje przy komputerze',resting:'Ładuje baterie',talking:'Prowadzi rozmowę'};

$('app').innerHTML = `
  <main id="world" aria-label="Dom z góry, kliknij podłogę aby poruszyć swoją postacią"></main>
  <header class="world-header">
    <div class="brand"><span class="pixel-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>AI WORLD</strong><span class="brand-divider"></span><span class="brand-subtitle">Dobrze być u siebie.</span></div>
    <div class="header-actions"><span id="connection" class="connection"><i></i><span>Łączenie…</span></span><button id="fullscreen" class="icon-button" title="Pełny ekran" aria-label="Pełny ekran">${icon('full')}</button><button id="help" class="icon-button" title="Jak grać" aria-label="Jak grać">${icon('info')}</button></div>
  </header>
  <div class="location-chip"><small>AI WORLD · WSPÓLNY DOM</small><strong id="current-room">Sypialnia</strong></div>
  <div class="room-caption"><span class="tiny-line"></span><span>WSPÓLNY DOM</span><span class="caption-dot">·</span><span id="world-clock">00:00</span></div>
  <button id="assistant-toggle" class="assistant-pill" aria-expanded="false" aria-controls="inspector"><span class="mini-avatar ultron-art"></span><span><strong id="mini-name">ULTRON</strong><small id="mini-status">Mieszkaniec domu</small></span><span class="pill-arrow">↗</span></button>
  <div class="scene-tools" aria-label="Powiększenie świata"><button id="view-toggle" class="view-toggle" aria-label="Pokaż cały dom">Cały dom</button><button id="zoom-out" aria-label="Oddal">−</button><span id="zoom-label">100%</span><button id="zoom-in" aria-label="Przybliż">+</button></div>
  <div id="touch-pad" class="touch-pad" aria-label="Sterowanie dotykowe"><button data-direction="up" aria-label="Idź do góry">↑</button><button data-direction="left" aria-label="Idź w lewo">←</button><button data-direction="down" aria-label="Idź w dół">↓</button><button data-direction="right" aria-label="Idź w prawo">→</button></div>
  <div class="bottom-area">
    <div id="world-hint" class="world-hint">Twój mały świat czeka. Naciśnij START.</div>
    <nav class="world-controls" aria-label="Sterowanie światem">
      <button data-control="start" class="primary">${icon('play')}<span>START</span></button>
      <button data-control="pause">${icon('pause')}<span>PAUZA</span></button>
      <button data-control="save">${icon('save')}<span>ZAPISZ</span></button>
      <button data-control="resume">${icon('resume')}<span>WZNÓW</span></button>
      <span class="control-divider"></span><button id="talk-shortcut" class="talk-button" aria-label="Napisz dymek nad sobą">${icon('chat')}<span>Powiedz coś</span></button>
    </nav>
    <div class="world-footer"><span><kbd>W A S D</kbd><span class="desktop-only"> / strzałki</span> lub dotknij podłogi</span><span id="save-status">Automatyczny zapis</span></div>
  </div>
  <form id="speech-form" class="speech-composer" hidden><div class="bubble-header"><strong>TY</strong><button id="close-speech" type="button" aria-label="Zamknij pisanie dymka">×</button></div><label id="speech-recipient" for="speech-input">Co chcesz powiedzieć?</label><textarea id="speech-input" maxlength="1000" rows="2" placeholder="Napisz, a potem podejdź do mieszkańca…" required></textarea><div class="bubble-footer"><small>Enter · wyślij  /  Esc · zamknij</small><button type="submit">Powiedz ▶</button></div></form>
  <aside id="inspector" class="inspector" aria-label="Panel asystenta" hidden>
    <div class="panel-header"><h1>Mieszkańcy</h1><button id="close-panel" class="icon-button" aria-label="Zamknij panel">${icon('close')}</button></div>
    <label class="agent-picker-label" for="agent-picker">Wybrana postać</label><select id="agent-picker"><option value="ultron_001">001 · ULTRON</option><option value="edith_002">002 · E.D.I.T.H.</option></select>
    <div class="agent-profile"><div class="portrait ultron-art"></div><div><h2><span id="agent-name">ULTRON</span><span class="online-dot"></span></h2><p id="agent-mood">Miło Cię widzieć.</p><small id="model-name">Ollama · lokalnie</small></div></div>
    <button id="find-resident" class="find-resident">Podejdź do mieszkańca ↗</button>
    <div class="tabs" role="tablist" aria-label="Informacje o asystencie"><button id="tab-state" data-tab="state" role="tab" aria-controls="tab-content" aria-selected="true">Stan</button><button id="tab-memory" data-tab="memory" role="tab" aria-controls="tab-content" aria-selected="false">Pamięć</button><button id="tab-history" data-tab="history" role="tab" aria-controls="tab-content" aria-selected="false">Rozmowy</button><button id="tab-profile" data-tab="profile" role="tab" aria-controls="tab-content" aria-selected="false">Cele</button><button id="tab-events" data-tab="events" role="tab" aria-controls="tab-content" aria-selected="false">Zdarzenia</button></div>
    <div id="tab-content" class="tab-content" role="tabpanel" aria-labelledby="tab-state"></div>
    <div id="ai-notice" class="ai-notice" hidden></div>
    <div class="panel-bottom"><button id="approach" class="approach">${icon('chat')}<span>Podejdź i porozmawiaj</span><span class="orange-arrow">${icon('arrow')}</span></button><form id="chat-form" hidden><label for="chat-input"><span id="chat-label">Rozmowa z ULTRONEM</span> <span id="chat-state"></span></label><div class="chat-input-row"><textarea id="chat-input" rows="2" maxlength="1000" placeholder="Co Ci chodzi po głowie?" required></textarea><button type="submit" class="send-button" aria-label="Wyślij wiadomość">${icon('arrow')}</button></div><small>Enter — wyślij · Shift + Enter — nowy wiersz</small></form></div>
  </aside>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <dialog id="help-dialog"><button class="dialog-close icon-button" aria-label="Zamknij">${icon('close')}</button><span class="dialog-art">${icon('sun')}</span><h2>Rozgość się.</h2><p>To wspólny dom E.D.I.T.H. i Ultrona. Każda postać ma własny model, cele i pamięć. Ich świat żyje, również gdy nie rozmawiacie.</p><ul><li><b>START</b> ożywia świat. <b>PAUZA</b> zatrzymuje czas.</li><li>Kliknij podłogę lub użyj <b>WASD / strzałek</b>, aby chodzić.</li><li>Kliknij mieszkańca, aby podejść i napisać do niego. Możesz też kliknąć siebie. Odpowiedź pojawi się w dymku z przyciskiem <b>Dalej ›</b>.</li><li>Dom ma sześć pokoi. Kamera płynnie przechodzi za Tobą; <b>Cały dom</b> pokazuje plan wszystkich pomieszczeń.</li><li><b>ZAPISZ</b> zachowuje stan w SQLite. Świat zapisuje się też automatycznie.</li><li><b>WZNÓW</b> kontynuuje zatrzymany świat.</li></ul><p class="muted">Na małym ekranie możesz dotykać podłogi albo używać przycisków kierunku. Panel mieszkańców otworzysz w prawym górnym rogu.</p><button id="help-done" class="primary">Wchodzę do świata ${icon('arrow')}</button></dialog>
  <dialog id="auth-dialog"><h2>Twój świat, także tutaj.</h2><p>Podaj token dostępu ustawiony na komputerze, na którym działa świat.</p><form id="auth-form"><label for="world-token">Token urządzenia</label><input id="world-token" type="password" autocomplete="off" minlength="24" required/><button class="primary">Połącz</button></form></dialog>
`;

let world: WorldState | undefined;
let online = false;
let activeTab = 'state';
let selectedAgentId = 'ultron_001';
let chatOpen = false;
let connection: WorldConnection;
let toastTimer: ReturnType<typeof setTimeout>;
let lastContent = '';
let zoom = 1;
let overview = false;
let speechRecipient: string | undefined;
let draftFocus: string | undefined;
let lastMessageCount = 0;

function toast(message: string) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4200); }
function send(message: ClientMessage) { if (!connection?.send(message)) { toast('Brak połączenia ze światem. Łączę ponownie…'); return false; } return true; }
function showPanel(show = true) { $('inspector').hidden = !show; $('assistant-toggle').setAttribute('aria-expanded', String(show)); document.body.classList.toggle('panel-open', show); }
const game = createWorldGame($('world'), {
  onMove: target => { send({ type:'move', target }); },
  onPlayerClick: () => openSpeech(),
  onPlayerPosition: (x,y) => positionComposer(x,y),
  onApproach: agentId => send({type:'conversation',agentId}),
  onInteract: agentId => {
    selectedAgentId = agentId;
    ($('agent-picker') as HTMLSelectElement).value = agentId;
    chatOpen = false; renderWorld(); openSpeech(agentId);
  },
  onHint: toast,
});

function updateTabs() {
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === activeTab)));
  $('tab-content').setAttribute('aria-labelledby', `tab-${activeTab}`); lastContent = '';
}
function renderWorld() {
  if (!world) return;
  const agent = world.agents.find(a => a.id === selectedAgentId) ?? world.agents[0];
  const decisions = world.decisions.filter(d => d.agentId === agent.id);
  const memories = world.memories.filter(m => m.agentId === agent.id);
  const messages = world.messages.filter(m => m.agentId === agent.id || m.targetAgentId === agent.id);
  const events = world.events.filter(e => e.agentId === agent.id);
  $('current-room').textContent = roomAt(world.player.position);
  $('find-resident').textContent = 'Podejdź do '+agent.name+' ↗';
  $('mini-name').textContent = $('agent-name').textContent = agent.name;
  $('chat-label').textContent = 'Rozmowa · ' + agent.name;
  document.querySelectorAll('.portrait,.mini-avatar').forEach(el => {
    el.classList.toggle('ultron-art', agent.profile.skin === 'ultron');
    el.classList.toggle('edith-art', agent.profile.skin === 'edith');
  });
  $('inspector').classList.toggle('ultron-panel', agent.profile.skin === 'ultron');
  const modelBusy = world.agents.some(a => a.ai.status === 'thinking' && a.activity === 'talking');
  $('world-clock').textContent = `${String(Math.floor(world.simTime / 60)).padStart(2,'0')}:${String(Math.floor(world.simTime % 60)).padStart(2,'0')}`;
  $('mini-status').textContent = world.running ? (agent.ai.status === 'thinking' ? 'Myśli…' : activityLabels[agent.activity]) : world.started ? 'Świat na pauzie' : 'Czeka na Ciebie';
  $('agent-mood').textContent = agent.mood;
  $('model-name').textContent = `${agent.ai.provider === 'ollama' ? 'Ollama · lokalnie' : 'Gemini'} / ${agent.ai.model}`;
  $('world-hint').textContent = !world.running ? 'Czas w domu zatrzymany.' : roomAt(world.player.position) + ' · Kliknij siebie, aby coś powiedzieć.';
  document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach(b => {
    b.disabled = !online || (b.dataset.control === 'start' && world!.started) || (b.dataset.control === 'pause' && !world!.running) || (b.dataset.control === 'resume' && (!world!.started || world!.running));
    b.hidden = (b.dataset.control === 'start' && world!.started) || (b.dataset.control === 'pause' && !world!.running) || (b.dataset.control === 'resume' && world!.running);
  });
  $('save-status').textContent = world.savedAt ? `Zapisano ${time(world.savedAt)}` : 'Automatyczny zapis';
  $('ai-notice').hidden = agent.ai.status !== 'offline';
  $('ai-notice').textContent = `${agent.ai.model} jest niedostępny. Postać korzysta z lokalnej rutyny. ${agent.ai.error ?? ''}`;
  if (agent.ai.provider === 'gemini') $('ai-notice').textContent = 'Model Gemini jest niedostępny. Sprawdź konfigurację serwera.';
  const nearby = distance(world.player.position, agent.position) <= INTERACTION_DISTANCE;
  $('chat-form').hidden = !chatOpen;
  $('approach').hidden = chatOpen;
  const busy = agent.ai.status === 'thinking';
  $('chat-state').textContent = busy ? agent.name + ' myśli…' : !nearby ? 'Podejdź bliżej' : '';
  $('chat-form').querySelector<HTMLButtonElement>('button')!.disabled = !world.running || modelBusy || !nearby || !online;
  let content = '';
  if (activeTab === 'state') content = `
    <section class="current-section"><h3>Teraz</h3><div class="activity"><span class="activity-icon">${icon(agent.activity === 'working' ? 'book' : 'leaf')}</span><div><strong>${activityLabels[agent.activity]}</strong><p>${escape(agent.thought)}</p></div></div></section>
    <div class="energy-row"><span>Energia</span><div class="energy-track"><i style="width:${Math.max(0, Math.min(100, agent.energy))}%"></i></div><small>${Math.round(agent.energy)}%</small></div>
    <section class="decisions"><h3>Ostatnie decyzje</h3>${decisions.length ? decisions.slice(-5).reverse().map(d => `<article class="decision"><time>${time(d.timestamp)}</time><span class="timeline-dot"></span><div><strong>${actionLabels[d.action]}</strong><p>${escape(d.reason)}</p><small>${d.source === 'routine' ? 'Lokalna rutyna' : 'Decyzja modelu · '+escape(d.source)}</small></div></article>`).join('') : '<div class="empty-state">Każdy dzień zaczyna się od pierwszego kroku.<br>Uruchom świat, a tutaj pojawią się decyzje wybranej postaci.</div>'}</section>`;
  if (activeTab === 'memory') content = `<section><div class="section-heading"><h3>Rzeczy, które zostają</h3><span>${memories.length}</span></div><p class="section-intro">Trwałe wspomnienia tej postaci. Osobny zapis od wydarzeń i rozmów.</p>${memories.length ? memories.slice().reverse().map(m => `<article class="memory-item">${icon('book')}<div><p>${escape(m.text)}</p><time>${time(m.timestamp)}</time></div></article>`).join('') : '<div class="empty-state">Jeszcze czysta kartka.<br>Poznajcie się — postać zapamięta ważne wydarzenia.</div>'}</section>`;
  if (activeTab === 'history') content = `<section><h3>Wasze rozmowy</h3>${messages.length ? messages.slice(-80).map(m => `<article class="message ${m.role}"><header><strong>${m.role === 'user' ? 'Ty' : escape(world!.agents.find(a => a.id === m.agentId)?.name ?? m.agentId)}</strong><time>${time(m.timestamp)}</time></header><p>${escape(m.text)}</p></article>`).join('') : '<div class="empty-state">Małe „cześć” to dobry początek.<br>Podejdź do postaci i napisz pierwszą wiadomość.</div>'}${busy ? '<div class="typing"><i></i><i></i><i></i><span>Model układa myśli…</span></div>' : ''}</section>`;
  if (activeTab === 'profile') content = `<section><h3>Tożsamość</h3><p class="section-intro">${escape(agent.profile.role)} · ${escape(agent.profile.universe)}</p><div class="traits">${agent.profile.traits.map(t => '<span>'+escape(t)+'</span>').join('')}</div><h3>Własne cele</h3><ol class="goals">${agent.profile.goals.map(g => '<li>'+escape(g)+'</li>').join('')}</ol><h3>Projekty w symulacji</h3>${agent.profile.plans.length ? agent.profile.plans.map(p => '<article class="project"><strong>'+escape(p.text)+'</strong><div class="energy-track"><i style="width:'+Math.round(p.progress)+'%"></i></div><small>'+(p.status === 'complete' ? 'Ukończony' : Math.round(p.progress)+'%')+'</small></article>').join('') : '<p class="empty-state">Nowe projekty powstają podczas autonomicznych decyzji modelu.</p>'}<h3>Relacje</h3>${agent.profile.relationships.length ? agent.profile.relationships.map(r => '<article class="memory-item"><div><strong>'+escape(r.targetId === 'player' ? 'Ty' : world!.agents.find(a => a.id === r.targetId)?.name ?? r.targetId)+' · '+r.affinity+'</strong><p>'+escape(r.note)+'</p></div></article>').join('') : '<p class="empty-state">Każda relacja zaczyna się od spotkania.</p>'}</section>`;
  if (activeTab === 'events') content = `<section><h3>Dziennik wydarzeń</h3>${events.length ? events.slice().reverse().map(e => '<article class="memory-item"><div><small>'+time(e.timestamp)+' · '+escape(e.kind)+'</small><p>'+escape(e.text)+'</p></div></article>').join('') : '<p class="empty-state">Świat czeka na pierwszy ruch.</p>'}</section>`;
  if (content !== lastContent) { $('tab-content').innerHTML = content; lastContent = content; if (activeTab === 'history' && messages.length !== lastMessageCount) $('tab-content').scrollTop = $('tab-content').scrollHeight; }
  lastMessageCount = messages.length;
}

async function connect() {
  let token = sessionStorage.getItem('ai-world-token') || '';
  try {
    const config = await fetch('/api/config').then(r => r.json());
    if (config.tokenRequired && !token) { ($('auth-dialog') as HTMLDialogElement).showModal(); return; }
  } catch { /* WebSocket reconnect handles temporary network loss */ }
  connection?.close();
  connection = new WorldConnection(message => {
    if (message.type === 'state') { world = message.world; game.setWorld(world); renderWorld(); }
    if (message.type === 'error') toast(message.message);
    if (message.type === 'saved') toast('Zapisano świat. Możesz spokojnie wrócić później.');
  }, connected => {
    online = connected;
    $('connection').classList.toggle('connected', connected);
    $('connection').querySelector('span')!.textContent = connected ? 'Świat połączony' : 'Łączenie…';
    renderWorld();
  }, token);
}

document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach(b => b.addEventListener('click', () => send({ type:'control', action:b.dataset.control as 'start'|'pause'|'save'|'resume' })));
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.addEventListener('click', () => { activeTab = b.dataset.tab!; updateTabs(); renderWorld(); }));
$('assistant-toggle').onclick = () => showPanel($('inspector').hidden);
$('close-panel').onclick = () => showPanel(false);
$('find-resident').onclick = () => {showPanel(false); game.focusAgent(selectedAgentId);};
$('approach').onclick = $('talk-shortcut').onclick = () => openSpeech();
$('agent-picker').onchange = () => { selectedAgentId = ($('agent-picker') as HTMLSelectElement).value; chatOpen = false; lastContent = ''; renderWorld(); };
$('fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { toast('Ta przeglądarka nie obsługuje pełnego ekranu. Świat już wypełnia okno.'); }
};
document.addEventListener('fullscreenchange', () => $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran'));
$('view-toggle').onclick = () => {
  overview=!overview; zoom=1; game.setOverview(overview); $('zoom-label').textContent='100%';
  $('view-toggle').textContent=overview?'Blisko mnie':'Cały dom';
  $('view-toggle').setAttribute('aria-label',overview?'Pokaż mój pokój':'Pokaż cały dom');
};
$('zoom-in').onclick = () => { zoom = Math.min(4, +(zoom + .5).toFixed(1)); game.setZoom(zoom); $('zoom-label').textContent = `${Math.round(zoom*100)}%`; };
$('zoom-out').onclick = () => { zoom = Math.max(1, +(zoom - .5).toFixed(1)); game.setZoom(zoom); $('zoom-label').textContent = `${Math.round(zoom*100)}%`; };
const help = $('help-dialog') as HTMLDialogElement;
$('help').onclick = () => help.showModal();
$('help-done').onclick = () => help.close();
help.querySelector<HTMLButtonElement>('.dialog-close')!.onclick = () => help.close();
document.addEventListener('keydown', e => { if (e.key === 'Escape') { showPanel(false); closeSpeech(); } });
function positionComposer(x:number,y:number) {
  const form=$('speech-form'); if(form.hidden)return;
  const width=form.offsetWidth,height=form.offsetHeight;
  const left=Math.max(14,Math.min(window.innerWidth-width-14,x-width/2));
  const top=Math.max(72,Math.min(window.innerHeight-height-74,y-height-18));
  form.style.left=Math.round(left)+'px';form.style.top=Math.round(top)+'px';
  form.style.setProperty('--tail-x',Math.round(Math.max(20,Math.min(width-30,x-left)))+'px');
}
function closeSpeech(release = true) {
  $('speech-form').hidden=true; document.body.classList.remove('composing');
  if (release) send({type:'conversation',agentId:null});
}
function updateRecipient() {
  const named = addressedResident(($('speech-input') as HTMLTextAreaElement).value);
  const id = named ?? speechRecipient ?? draftFocus;
  const recipient = world?.agents.find(a=>a.id===id);
  $('speech-recipient').textContent=recipient?'Do: '+recipient.name:'Powiedz coś, a potem podejdź do mieszkańca';
  if (recipient && recipient.id !== draftFocus) { draftFocus=recipient.id; send({type:'conversation',agentId:recipient.id}); }
}
function openSpeech(agentId?: string) {
  if (!world?.running) { toast('Wznów czas w domu, aby coś powiedzieć.'); return; }
  speechRecipient=agentId;
  const previous=world.agents.find(a=>a.id===world!.playerSpeech?.targetAgentId && distance(a.position,world!.player.position)<=INTERACTION_DISTANCE && canSee(a.position,world!.player.position));
  draftFocus=agentId ?? previous?.id ?? world.agents.filter(a=>distance(a.position,world!.player.position)<=INTERACTION_DISTANCE && canSee(a.position,world!.player.position)).sort((a,b)=>distance(a.position,world!.player.position)-distance(b.position,world!.player.position))[0]?.id;
  if(draftFocus)send({type:'conversation',agentId:draftFocus});
  updateRecipient();
  showPanel(false); $('speech-form').hidden = false; document.body.classList.add('composing'); $('speech-input').focus();
}
$('close-speech').onclick = () => closeSpeech();
$('speech-input').oninput = updateRecipient;
setInterval(()=>{if(!$('speech-form').hidden && draftFocus)send({type:'conversation',agentId:draftFocus});},12000);
$('speech-form').onsubmit = event => {
  event.preventDefault(); const input = $('speech-input') as HTMLTextAreaElement;
  const recipient=addressedResident(input.value) ?? speechRecipient ?? draftFocus;
  if (input.value.trim() && send({type:'say',text:input.value.trim(),...(recipient ? {agentId:recipient} : {})})) { input.value=''; closeSpeech(false); }
};
$('speech-input').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ($('speech-form') as HTMLFormElement).requestSubmit(); } };
const chatInput = $('chat-input') as HTMLTextAreaElement;
$('chat-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = chatInput.value.trim();
  const agent = world?.agents.find(a => a.id === selectedAgentId);
  const busy = world?.agents.some(a => a.ai.status === 'thinking' && a.activity === 'talking');
  if (text && world?.running && agent && online && !busy && distance(world.player.position,agent.position)<=INTERACTION_DISTANCE && send({ type:'chat',text,agentId: agent.id })) chatInput.value = '';
});
chatInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ($('chat-form') as HTMLFormElement).requestSubmit(); } });
document.querySelectorAll<HTMLButtonElement>('[data-direction]').forEach(button => {
  const dirs: Record<string, [number,number]> = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
  let interval: ReturnType<typeof setInterval> | undefined;
  const stop = () => clearInterval(interval);
  button.onpointerdown = event => { event.preventDefault(); button.setPointerCapture(event.pointerId); game.moveDirection(...dirs[button.dataset.direction!]); interval = setInterval(() => game.moveDirection(...dirs[button.dataset.direction!]), 220); };
  button.onpointerup = button.onpointercancel = button.onlostpointercapture = stop;
});
$('auth-form').onsubmit = event => { event.preventDefault(); sessionStorage.setItem('ai-world-token', ($('world-token') as HTMLInputElement).value.trim()); ($('auth-dialog') as HTMLDialogElement).close(); void connect(); };
window.addEventListener('beforeunload', () => { connection?.close(); game.destroy(); });
void connect();
