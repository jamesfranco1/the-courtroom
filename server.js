require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const express = require('express');
const OpenAI = require('openai');
const {
  CASE_SOURCE_URL,
  PERSONAS,
  transcriptToMessages,
  verdictToMessages
} = require('./prompts');

const app = express();
const port = Number(process.env.PORT || 4173);
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const minDebateTurns = Math.max(2, Number(process.env.MIN_DEBATE_TURNS || 40));
const maxDebateTurns = Math.max(minDebateTurns, Number(process.env.MAX_DEBATE_TURNS || 80));
const grokWinBias = Math.min(1, Math.max(0, Number(process.env.GROK_WIN_BIAS || 0.9)));
const clients = new Set();

const statsDirRaw = process.env.STATS_DIR || 'data';
const statsDir = path.isAbsolute(statsDirRaw) ? statsDirRaw : path.join(__dirname, statsDirRaw);
const statsFile = path.join(statsDir, 'stats.json');

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

let wins = { grok: 0, openai: 0 };

function loadStats() {
  try {
    fs.mkdirSync(statsDir, { recursive: true });
    if (fs.existsSync(statsFile)) {
      const parsed = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        wins = {
          grok: Number(parsed.grok) || 0,
          openai: Number(parsed.openai) || 0
        };
      }
    }
  } catch (_) {
    // ignore — keep in-memory defaults
  }
}

function saveStats() {
  try {
    fs.mkdirSync(statsDir, { recursive: true });
    const tmp = `${statsFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(wins));
    fs.renameSync(tmp, statsFile);
  } catch (_) {
    // ignore — counter still lives in memory
  }
}

loadStats();

function pickVerdictAt() {
  const lo = Math.floor(minDebateTurns);
  const hi = Math.floor(maxDebateTurns);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

const court = {
  id: crypto.randomUUID(),
  status: 'waiting',
  turn: 0,
  verdictAt: pickVerdictAt(),
  running: false,
  transcript: []
};

app.use(express.static(path.join(__dirname, 'public')));

function now() {
  return Date.now();
}

function entry(speaker, text, id = crypto.randomUUID(), extra = null) {
  const e = { id, speaker, text, createdAt: now() };
  if (extra) Object.assign(e, extra);
  return e;
}

function snapshot() {
  return {
    id: court.id,
    status: court.status,
    turn: court.turn,
    verdictAt: court.verdictAt,
    wins: { ...wins },
    model,
    caseSourceUrl: CASE_SOURCE_URL,
    transcript: court.transcript
  };
}

function writeEvent(res, event, data) {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  return true;
}

function broadcast(event, data) {
  for (const res of clients) {
    writeEvent(res, event, data);
  }
}

function resetCourt(status = 'waiting') {
  court.id = crypto.randomUUID();
  court.status = status;
  court.turn = 0;
  court.verdictAt = pickVerdictAt();
  court.running = false;
  court.transcript = [];
  broadcast('state', snapshot());
}

function openCourt() {
  court.id = crypto.randomUUID();
  court.status = 'live';
  court.turn = 0;
  court.verdictAt = pickVerdictAt();
  court.transcript = [
    entry(
      'judge',
      'COURT IS NOW IN SESSION. Matter: Musk v. Altman/OpenAI. Issue: alleged Founding Agreement, nonprofit mission, openness, Microsoft, and control. Counsel appearing as GROK may proceed.'
    )
  ];
  broadcast('state', snapshot());
}

async function streamTurn(speaker) {
  const messageId = crypto.randomUUID();
  let text = '';

  broadcast('turn-start', {
    id: messageId,
    speaker,
    displayName: PERSONAS[speaker].displayName,
    roleLabel: PERSONAS[speaker].roleLabel
  });

  const stream = await openai.chat.completions.create({
    model,
    stream: true,
    temperature: speaker === 'grok' ? 0.82 : 0.68,
    max_tokens: 150,
    messages: transcriptToMessages(court, speaker)
  });

  for await (const part of stream) {
    if (court.status !== 'live') break;

    const token = part.choices?.[0]?.delta?.content || '';
    if (!token) continue;

    text += token;
    broadcast('token', { id: messageId, speaker, token });
  }

  const cleanText = text.trim();
  if (!cleanText) return;

  const statement = entry(speaker, cleanText, messageId);
  court.transcript.push(statement);
  court.turn += 1;
  broadcast('turn-end', statement);
}

async function streamVerdict(winner) {
  const messageId = crypto.randomUUID();
  let text = '';

  broadcast('turn-start', {
    id: messageId,
    speaker: 'judge',
    displayName: 'THE BENCH',
    roleLabel: 'Verdict'
  });

  const stream = await openai.chat.completions.create({
    model,
    stream: true,
    temperature: 0.4,
    max_tokens: 220,
    messages: verdictToMessages(court, winner)
  });

  for await (const part of stream) {
    const token = part.choices?.[0]?.delta?.content || '';
    if (!token) continue;

    text += token;
    broadcast('token', { id: messageId, speaker: 'judge', token });
  }

  const cleanText = text.trim() || (winner === 'grok'
    ? 'JUDGMENT FOR GROK / MUSK. COURT IS ADJOURNED.'
    : 'JUDGMENT FOR OPENAI / ALTMAN. COURT IS ADJOURNED.');

  const statement = entry('judge', cleanText, messageId, { verdict: winner });
  court.transcript.push(statement);
  broadcast('turn-end', statement);
}

async function runCourt() {
  if (court.running) return;
  if (!openai) {
    court.status = 'missing-key';
    broadcast('state', snapshot());
    console.log('[court] OPENAI_API_KEY missing. Add it, restart, then start.');
    return;
  }

  court.running = true;
  console.log(`[court] live: ${court.id} verdictAt=${court.verdictAt}`);

  try {
    while (court.status === 'live' && court.turn < court.verdictAt) {
      const speaker = court.turn % 2 === 0 ? 'grok' : 'openai';
      await streamTurn(speaker);
    }

    if (court.status === 'live') {
      const winner = Math.random() < grokWinBias ? 'grok' : 'openai';
      await streamVerdict(winner);
      wins[winner] += 1;
      saveStats();
      court.status = 'adjourned';
      broadcast('state', snapshot());
      console.log(`[court] verdict: ${winner}; wins=grok:${wins.grok}/openai:${wins.openai}`);
    } else {
      broadcast('state', snapshot());
      console.log(`[court] ${court.status}; turns=${court.turn}/${court.verdictAt}`);
    }
  } catch (error) {
    court.status = 'error';
    broadcast('court-error', {
      message: error.message || 'The courtroom feed failed.'
    });
    broadcast('state', snapshot());
    console.log(`[court] error: ${error.message}`);
  } finally {
    court.running = false;
  }
}

function startCourt() {
  if (court.running) {
    console.log('[court] already live');
    return;
  }

  openCourt();
  runCourt();
}

function pauseCourt() {
  if (court.status !== 'live') {
    console.log(`[court] cannot pause while status=${court.status}`);
    return;
  }

  court.status = 'paused';
  broadcast('state', snapshot());
  console.log('[court] paused');
}

app.get('/api/courtroom/state', (req, res) => {
  res.json(snapshot());
});

const adminToken = process.env.ADMIN_TOKEN || '';

function requireAdmin(req, res, next) {
  if (!adminToken) {
    return res.status(503).json({ error: 'ADMIN_TOKEN not configured on server.' });
  }

  const provided = req.get('x-admin-token') || '';
  if (provided !== adminToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  return next();
}

app.post('/admin/start', requireAdmin, (req, res) => {
  startCourt();
  res.json({ ok: true, status: court.status, verdictAt: court.verdictAt });
});

app.post('/admin/pause', requireAdmin, (req, res) => {
  pauseCourt();
  res.json({ ok: true, status: court.status });
});

app.post('/admin/reset', requireAdmin, (req, res) => {
  resetCourt();
  res.json({ ok: true, status: court.status });
});

app.get('/admin/status', requireAdmin, (req, res) => {
  res.json({
    status: court.status,
    turn: court.turn,
    verdictAt: court.verdictAt,
    wins,
    viewers: clients.size,
    running: court.running
  });
});

app.get('/api/courtroom/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  clients.add(res);
  writeEvent(res, 'state', snapshot());

  req.on('close', () => {
    clients.delete(res);
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    configured: Boolean(openai),
    status: court.status,
    clients: clients.size,
    model,
    wins
  });
});

const server = app.listen(port, () => {
  console.log(`The Courtroom viewer: http://localhost:${port}`);
  console.log('Backend controls: type start, pause, reset, status, or help');
  if (!openai) console.log('[court] OPENAI_API_KEY is not set. start will not run model turns.');
});

server.on('error', (error) => {
  console.log(`[court] server error: ${error.message}`);
});

if (process.stdin.isTTY) {
  const cli = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'court> '
  });

  cli.on('line', (line) => {
    const command = line.trim().toLowerCase();

    if (command === 'start') startCourt();
    else if (command === 'pause') pauseCourt();
    else if (command === 'reset') {
      resetCourt();
      console.log('[court] reset to waiting room');
    } else if (command === 'status') {
      console.log(`[court] status=${court.status} turns=${court.turn}/${court.verdictAt} wins=grok:${wins.grok}/openai:${wins.openai} viewers=${clients.size}`);
    } else if (command === 'help') {
      console.log('commands: start | pause | reset | status | help');
    } else if (command) {
      console.log(`unknown command: ${command}`);
    }

    cli.prompt();
  });

  cli.prompt();
} else {
  console.log('[court] stdin is not interactive; CLI prompt disabled for this process.');
}
