const TYPE_INTERVAL_MS = 33;

const waitingRoom = document.getElementById('waitingRoom');
const transcriptEl = document.getElementById('transcript');
const template = document.getElementById('messageTemplate');
const winsGrokEl = document.getElementById('winsGrok');
const winsOpenaiEl = document.getElementById('winsOpenai');

const activeMessages = new Map();

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
  for (const record of activeMessages.values()) {
    if (record.intervalId) clearInterval(record.intervalId);
  }
  activeMessages.clear();
  transcriptEl.innerHTML = '';
}

function renderScoreboard(wins) {
  if (!wins) return;
  if (winsGrokEl) winsGrokEl.textContent = String(wins.grok ?? 0);
  if (winsOpenaiEl) winsOpenaiEl.textContent = String(wins.openai ?? 0);
}

function createMessageRecord({ id, speaker, text = '', createdAt }) {
  const node = template.content.firstElementChild.cloneNode(true);
  const time = createdAt ? new Date(createdAt) : new Date();

  node.dataset.id = id;
  node.classList.add(`message-${speaker}`);
  node.querySelector('.speaker').textContent = speakerLabel(speaker);
  node.querySelector('time').textContent = time.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const pEl = node.querySelector('p');
  pEl.textContent = text;
  transcriptEl.appendChild(node);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;

  const record = {
    node,
    pEl,
    queue: [],
    typing: false,
    finalized: false,
    finalText: text,
    intervalId: null
  };
  activeMessages.set(id, record);
  return record;
}

function createSettledMessage(entry) {
  const record = createMessageRecord({
    id: entry.id,
    speaker: entry.speaker,
    text: entry.text,
    createdAt: entry.createdAt
  });
  record.finalized = true;
  record.finalText = entry.text;
  return record;
}

function startTyping(record) {
  if (record.typing) return;
  record.typing = true;
  record.intervalId = setInterval(() => {
    if (record.queue.length === 0) {
      if (record.finalized) {
        clearInterval(record.intervalId);
        record.intervalId = null;
        record.typing = false;
        record.node.classList.remove('is-typing');
      }
      return;
    }
    const ch = record.queue.shift();
    record.pEl.textContent += ch;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }, TYPE_INTERVAL_MS);
}

function appendToken({ id, speaker, token }) {
  let record = activeMessages.get(id);
  if (!record) {
    record = createMessageRecord({ id, speaker });
    record.node.classList.add('is-typing');
  }
  for (const ch of token) record.queue.push(ch);
  startTyping(record);
}

function finalizeMessage(entry) {
  const record = activeMessages.get(entry.id);
  if (!record) {
    createSettledMessage(entry);
    return;
  }

  record.finalText = entry.text;
  record.finalized = true;

  const visibleLen = record.pEl.textContent.length + record.queue.length;
  if (visibleLen < entry.text.length) {
    const tail = entry.text.slice(visibleLen);
    for (const ch of tail) record.queue.push(ch);
  }

  startTyping(record);
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
    const data = JSON.parse(event.data);
    setSessionVisible(true);
    const record = createMessageRecord({ id: data.id, speaker: data.speaker, text: '' });
    record.node.classList.add('is-typing');
  });

  events.addEventListener('token', (event) => {
    appendToken(JSON.parse(event.data));
  });

  events.addEventListener('turn-end', (event) => {
    finalizeMessage(JSON.parse(event.data));
  });
}

setSessionVisible(false);
clearTranscript();
connect();
