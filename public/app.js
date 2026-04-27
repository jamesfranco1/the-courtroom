const waitingRoom = document.getElementById('waitingRoom');
const transcriptEl = document.getElementById('transcript');
const template = document.getElementById('messageTemplate');

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
  activeMessages.clear();
  transcriptEl.innerHTML = '';
}

function createMessage({ id, speaker, text = '', createdAt }) {
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
  node.querySelector('p').textContent = text;
  transcriptEl.appendChild(node);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  activeMessages.set(id, node);
  return node;
}

function appendToken({ id, speaker, token }) {
  const node = activeMessages.get(id) || createMessage({ id, speaker });
  node.querySelector('p').textContent += token;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function finalizeMessage(entry) {
  const node = activeMessages.get(entry.id) || createMessage(entry);
  node.querySelector('p').textContent = entry.text;
  node.classList.remove('is-typing');
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function applyState(state) {
  const inSession = Boolean(state.transcript && state.transcript.length);
  setSessionVisible(inSession);
  clearTranscript();
  if (!inSession) return;
  for (const entry of state.transcript) createMessage(entry);
}

function connect() {
  const events = new EventSource('/api/courtroom/events');

  events.addEventListener('state', (event) => {
    applyState(JSON.parse(event.data));
  });

  events.addEventListener('turn-start', (event) => {
    const data = JSON.parse(event.data);
    setSessionVisible(true);
    const node = createMessage({ id: data.id, speaker: data.speaker, text: '' });
    node.classList.add('is-typing');
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
