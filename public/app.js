const TYPE_INTERVAL_MS = 33;

const waitingRoom = document.getElementById('waitingRoom');
const transcriptEl = document.getElementById('transcript');
const template = document.getElementById('messageTemplate');
const winsGrokEl = document.getElementById('winsGrok');
const winsOpenaiEl = document.getElementById('winsOpenai');

const messageRecords = new Map();
const pendingOrder = [];
let currentRecord = null;
let pumpInterval = null;

function speakerLabel(speaker) {
  if (speaker === 'grok') return 'COUNSEL FOR MUSK';
  if (speaker === 'openai') return 'COUNSEL FOR OPENAI';
  if (speaker === 'judge') return 'THE COURT';
  return 'THE RECORD';
}

function setSessionVisible(isInSession) {
  waitingRoom.hidden = isInSession;
}

function clearTranscript() {
  if (pumpInterval) {
    clearInterval(pumpInterval);
    pumpInterval = null;
  }
  messageRecords.clear();
  pendingOrder.length = 0;
  currentRecord = null;
  transcriptEl.innerHTML = '';
}

function renderScoreboard(wins) {
  if (!wins) return;
  if (winsGrokEl) winsGrokEl.textContent = String(wins.grok ?? 0);
  if (winsOpenaiEl) winsOpenaiEl.textContent = String(wins.openai ?? 0);
}

function ensureRecord(id, speaker) {
  let record = messageRecords.get(id);
  if (record) return record;

  record = {
    id,
    speaker,
    queue: [],
    finalized: false,
    finalText: '',
    node: null,
    pEl: null,
    started: false,
    createdAt: Date.now()
  };
  messageRecords.set(id, record);
  pendingOrder.push(id);
  return record;
}

function mountMessageNode(record) {
  const node = template.content.firstElementChild.cloneNode(true);
  const time = new Date(record.createdAt);

  node.dataset.id = record.id;
  node.classList.add(`message-${record.speaker}`, 'is-typing');
  node.querySelector('.speaker').textContent = speakerLabel(record.speaker);
  node.querySelector('time').textContent = time.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const pEl = node.querySelector('p');
  pEl.textContent = '';
  transcriptEl.appendChild(node);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;

  record.node = node;
  record.pEl = pEl;
}

function createSettledMessage(entry) {
  const node = template.content.firstElementChild.cloneNode(true);
  const time = entry.createdAt ? new Date(entry.createdAt) : new Date();

  node.dataset.id = entry.id;
  node.classList.add(`message-${entry.speaker}`);
  node.querySelector('.speaker').textContent = speakerLabel(entry.speaker);
  node.querySelector('time').textContent = time.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  node.querySelector('p').textContent = entry.text;
  transcriptEl.appendChild(node);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function ensurePump() {
  if (pumpInterval) return;
  pumpInterval = setInterval(pump, TYPE_INTERVAL_MS);
}

function pump() {
  if (!currentRecord) {
    while (pendingOrder.length && !messageRecords.has(pendingOrder[0])) {
      pendingOrder.shift();
    }
    if (!pendingOrder.length) {
      clearInterval(pumpInterval);
      pumpInterval = null;
      return;
    }
    currentRecord = messageRecords.get(pendingOrder.shift());
  }

  const r = currentRecord;
  if (!r.started) {
    mountMessageNode(r);
    r.started = true;
  }

  if (r.queue.length > 0) {
    r.pEl.textContent += r.queue.shift();
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    return;
  }

  if (r.finalized) {
    r.node.classList.remove('is-typing');
    currentRecord = null;
  }
}

function handleTurnStart({ id, speaker }) {
  ensureRecord(id, speaker);
  ensurePump();
}

function handleToken({ id, speaker, token }) {
  const record = ensureRecord(id, speaker);
  for (const ch of token) record.queue.push(ch);
  ensurePump();
}

function handleTurnEnd(entry) {
  const record = ensureRecord(entry.id, entry.speaker);
  record.finalText = entry.text;
  record.finalized = true;

  const visibleLen = (record.pEl ? record.pEl.textContent.length : 0) + record.queue.length;
  if (visibleLen < entry.text.length) {
    const tail = entry.text.slice(visibleLen);
    for (const ch of tail) record.queue.push(ch);
  }

  ensurePump();
}

function applyState(state) {
  renderScoreboard(state.wins);
  const inSession = Boolean(state.transcript && state.transcript.length);
  setSessionVisible(inSession);
  clearTranscript();
  if (!inSession) return;
  for (const entry of state.transcript) createSettledMessage(entry);
}

function connect() {
  const events = new EventSource('/api/courtroom/events');

  events.addEventListener('state', (event) => {
    applyState(JSON.parse(event.data));
  });

  events.addEventListener('turn-start', (event) => {
    setSessionVisible(true);
    handleTurnStart(JSON.parse(event.data));
  });

  events.addEventListener('token', (event) => {
    handleToken(JSON.parse(event.data));
  });

  events.addEventListener('turn-end', (event) => {
    handleTurnEnd(JSON.parse(event.data));
  });
}

setSessionVisible(false);
clearTranscript();
connect();
