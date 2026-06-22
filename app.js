/* ===================================================
 * UNO Master — Cliente vanilla
 * Comunica con el backend Node + ws sobre WebSockets.
 * =================================================== */

const COLOR_MAP = { Rojo: 'Red', Amarillo: 'Yellow', Verde: 'Green', Azul: 'Blue', 'Comodín': 'Wild' };
const VALUE_MAP = {
  '0': 'Zero', '1': 'One', '2': 'Two', '3': 'Three', '4': 'Four',
  '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine',
  Bloqueo: 'SkipTurn', CambioSentido: 'Reverse',
  '+2': 'DrawTwo', '+4': 'DrawFour', CambiaColor: 'ChangeColor',
};
const COLORS = ['Rojo', 'Amarillo', 'Verde', 'Azul'];

const DEFAULT_WS = 'ws://localhost:3000';

/** Devuelve la ruta de imagen para una carta del servidor. */
function cardImage(card) {
  let color, value;
  if (card.color === 'Comodín' || (card.isComodinReal && (card.value === 'CambiaColor' || card.value === '+4'))) {
    color = 'Wild';
    value = VALUE_MAP[card.value] || card.value;
  } else {
    color = COLOR_MAP[card.color] || card.color;
    value = VALUE_MAP[card.value] || card.value;
  }
  return `assets/${color}_${value}.png`;
}

/* ============== Estado global ============== */
const state = {
  ws: null,
  name: '',
  url: DEFAULT_WS,
  phase: 'setup',          // 'setup' | 'lobby' | 'game'
  gameState: null,
  log: [],
  pendingWildIndex: null,
  toastTimer: null,
};

/* ============== Helpers DOM ============== */
const $ = (id) => document.getElementById(id);

function showScreen(name) {
  state.phase = name;
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

/* ============== Conexión WebSocket ============== */
function connect() {
  try {
    state.ws = new WebSocket(state.url);
  } catch (e) {
    showToast('URL inválida: ' + e.message);
    return;
  }
  $('setup-status').textContent = 'Conectando…';

  state.ws.addEventListener('open', () => {
    $('setup-status').textContent = '';
    send('joinGame', state.name);
    showScreen('lobby');
    renderLobby([state.name]);
  });
  state.ws.addEventListener('close', () => {
    $('setup-status').textContent = 'Conexión cerrada.';
  });
  state.ws.addEventListener('error', () => {
    $('setup-status').textContent = 'Error de conexión. Revisa la URL del servidor.';
  });
  state.ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleServerMessage(msg);
  });
}

function send(type, data) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify({ type, data }));
}

function disconnect() {
  if (state.ws) {
    try { state.ws.close(); } catch {}
    state.ws = null;
  }
  state.gameState = null;
  state.log = [];
  state.pendingWildIndex = null;
}

/* ============== Manejo de eventos del servidor ============== */
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'waitingRoom':
      renderLobby(msg.data || []);
      break;
    case 'gameState':
      state.gameState = msg.data;
      if (msg.data.log) {
        state.log.unshift(msg.data.log);
        state.log = state.log.slice(0, 30);
      }
      if (msg.data.gameStarted) showScreen('game');
      renderGame();
      break;
    case 'showPopup':
      $('popup-message').textContent = msg.data;
      openModal('modal-popup');
      break;
    case 'errorMsg':
      showToast(msg.data);
      break;
    case 'gameOver':
      $('gameover-message').textContent = msg.data;
      openModal('modal-gameover');
      break;
  }
}

/* ============== Render: Lobby ============== */
function renderLobby(players) {
  $('lobby-count').textContent = players.length;
  const grid = $('lobby-slots');
  grid.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = players[i];
    const div = document.createElement('div');
    div.className = 'lobby-slot';
    if (p) div.classList.add('filled');
    if (p === state.name) div.classList.add('me');
    div.innerHTML = `
      <div class="icon">${p ? '🎴' : '⌛'}</div>
      <div class="name">${p ? escapeHtml(p) : 'vacío'}</div>
      ${p === state.name ? '<div class="tag">TÚ</div>' : ''}
    `;
    grid.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ============== Render: Juego ============== */
function renderGame() {
  const g = state.gameState;
  if (!g) return;

  $('game-direction').textContent = g.direction;
  const turnEl = $('game-turn');
  turnEl.textContent = g.currentTurnName + (g.currentTurnName === state.name ? ' (TÚ)' : '');
  turnEl.classList.toggle('me', g.currentTurnName === state.name);
  $('game-handcount').textContent = g.hand.length;
  $('game-dijouno').classList.toggle('hidden', !g.dijoUno);
  $('game-log').textContent = g.log || '';
  $('img-top').src = cardImage(g.topCard);
  $('img-top').alt = `${g.topCard.color} ${g.topCard.value}`;

  $('btn-draw').disabled = !(g.isMyTurn && !g.isPaused);

  $('botonera-uno').classList.toggle('hidden', !g.mostrarBotoneraUno);
  $('paused-banner').classList.toggle('hidden', !g.isPaused);

  // Mano
  const hand = $('hand');
  hand.innerHTML = '';
  g.hand.forEach((card, i) => {
    const playable = g.isMyTurn && !g.isPaused && isPlayable(card, g.topCard);
    const btn = document.createElement('button');
    btn.className = 'hand-card' + (playable ? ' playable' : '');
    btn.disabled = !playable;
    btn.innerHTML = `<img src="${cardImage(card)}" alt="${escapeHtml(card.color)} ${escapeHtml(card.value)}" />`;
    btn.addEventListener('click', () => onPlayCard(i, card));
    hand.appendChild(btn);
  });

  // Historial
  const list = $('log-list');
  list.innerHTML = '';
  state.log.slice(0, 8).forEach((line) => {
    const li = document.createElement('li');
    li.textContent = '• ' + line;
    list.appendChild(li);
  });
}

function isPlayable(card, top) {
  if (card.color === 'Comodín') return true;
  return card.color === top.color || card.value === top.value;
}

function onPlayCard(index, card) {
  if (card.color === 'Comodín') {
    state.pendingWildIndex = index;
    openModal('modal-wild');
    return;
  }
  send('playCard', { index, chosenColor: null });
}

/* ============== Eventos UI ============== */
function bindUI() {
  // Setup
  const savedName = localStorage.getItem('uno:name');
  const savedUrl = localStorage.getItem('uno:wsUrl');
  if (savedName) $('input-name').value = savedName;
  $('input-url').value = savedUrl || DEFAULT_WS;

  $('form-setup').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('input-name').value.trim();
    const url = $('input-url').value.trim();
    if (!name || !url) return;
    state.name = name;
    state.url = url;
    localStorage.setItem('uno:name', name);
    localStorage.setItem('uno:wsUrl', url);
    connect();
  });

  $('btn-leave-lobby').addEventListener('click', () => {
    disconnect();
    showScreen('setup');
  });

  $('btn-draw').addEventListener('click', () => {
    if (!state.gameState?.isMyTurn || state.gameState.isPaused) return;
    send('drawCard');
  });

  $('btn-uno').addEventListener('click', () => send('cantarUno'));
  $('btn-corte').addEventListener('click', () => send('cantarCorte'));

  // Wild color picker
  document.querySelectorAll('#modal-wild .color-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const color = b.getAttribute('data-color');
      if (state.pendingWildIndex == null) return;
      send('playCard', { index: state.pendingWildIndex, chosenColor: color });
      state.pendingWildIndex = null;
      closeModal('modal-wild');
    });
  });

  $('btn-popup-resolve').addEventListener('click', () => {
    closeModal('modal-popup');
    send('resolvePopup');
  });

  $('btn-gameover-reset').addEventListener('click', () => {
    closeModal('modal-gameover');
    disconnect();
    showScreen('setup');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  showScreen('setup');
});
