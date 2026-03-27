const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const http = require('http');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({ origin: '*' }));
app.use(express.json());

// In-memory storage (replace with DB in production)
const store = {
  events: [],         // card draw events
  questions: [],      // viewer questions
  cooldowns: {},      // userId -> timestamp
  channels: {},       // channelId -> config
  globalState: {},    // channelId -> active global event
};

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const QUESTION_COOLDOWN_MS = 3 * 60 * 1000;

// ─── TAROT DECK ────────────────────────────────────────────────────────────────
const TAROT_DECK = [
  { id: 'fool',        name: 'Шут',              mood: '✨ Авантюра',    shortMeaning: 'Новое начало, прыжок в неизвестность',         advice: 'Доверься потоку и сделай первый шаг',         image: '0_fool' },
  { id: 'magician',    name: 'Маг',               mood: '🔥 Сила',       shortMeaning: 'Воля, мастерство, воплощение идей',            advice: 'Всё нужное уже есть внутри тебя',             image: '1_magician' },
  { id: 'priestess',   name: 'Верховная Жрица',   mood: '🌙 Тайна',      shortMeaning: 'Интуиция, скрытое знание, ожидание',          advice: 'Прислушайся к тишине — ответ уже есть',       image: '2_priestess' },
  { id: 'empress',     name: 'Императрица',        mood: '🌸 Изобилие',   shortMeaning: 'Творчество, плодородие, забота',              advice: 'Позволь себе расцвести',                      image: '3_empress' },
  { id: 'emperor',     name: 'Император',          mood: '🏰 Власть',     shortMeaning: 'Порядок, структура, авторитет',               advice: 'Установи правила и следуй им',                image: '4_emperor' },
  { id: 'hierophant',  name: 'Иерофант',           mood: '📜 Традиция',   shortMeaning: 'Духовное руководство, традиции, обучение',    advice: 'Ищи наставника или стань им',                 image: '5_hierophant' },
  { id: 'lovers',      name: 'Влюблённые',         mood: '💕 Выбор',      shortMeaning: 'Союз, гармония, важный выбор',                advice: 'Следуй за сердцем, но слушай разум',          image: '6_lovers' },
  { id: 'chariot',     name: 'Колесница',          mood: '⚡ Победа',     shortMeaning: 'Воля, контроль, преодоление препятствий',     advice: 'Удержи курс — победа близко',                 image: '7_chariot' },
  { id: 'strength',    name: 'Сила',               mood: '🦁 Мужество',   shortMeaning: 'Внутренняя сила, терпение, смелость',         advice: 'Мягкость сильнее грубой силы',                image: '8_strength' },
  { id: 'hermit',      name: 'Отшельник',          mood: '🕯 Поиск',      shortMeaning: 'Уединение, мудрость, внутренний путь',        advice: 'Ответ найдётся в тишине и одиночестве',       image: '9_hermit' },
  { id: 'wheel',       name: 'Колесо Фортуны',     mood: '🎡 Перемены',   shortMeaning: 'Цикл, судьба, неожиданные повороты',          advice: 'Всё меняется — прими это как дар',            image: '10_wheel' },
  { id: 'justice',     name: 'Справедливость',     mood: '⚖️ Баланс',     shortMeaning: 'Истина, закон, кармический итог',             advice: 'Поступай честно — вселенная всё видит',       image: '11_justice' },
  { id: 'hangedman',   name: 'Повешенный',         mood: '🌀 Пауза',      shortMeaning: 'Жертва, иная перспектива, ожидание',          advice: 'Переверни точку зрения — увидишь больше',     image: '12_hangedman' },
  { id: 'death',       name: 'Смерть',             mood: '🌑 Трансформация', shortMeaning: 'Окончание, переход, перерождение',         advice: 'Отпусти старое — впереди новая глава',        image: '13_death' },
  { id: 'temperance',  name: 'Умеренность',        mood: '🌊 Равновесие', shortMeaning: 'Баланс, исцеление, терпение',                 advice: 'Найди золотую середину',                      image: '14_temperance' },
  { id: 'devil',       name: 'Дьявол',             mood: '🔗 Иллюзия',    shortMeaning: 'Оковы, страсть, материализм',                 advice: 'Осознай цепи — и ты уже свободен',            image: '15_devil' },
  { id: 'tower',       name: 'Башня',              mood: '⚡ Потрясение',  shortMeaning: 'Крах иллюзий, хаос, очищение',               advice: 'Разрушение — это начало строительства',       image: '16_tower' },
  { id: 'star',        name: 'Звезда',             mood: '💫 Надежда',    shortMeaning: 'Вдохновение, исцеление, мечты',               advice: 'Ты идёшь в правильном направлении',           image: '17_star' },
  { id: 'moon',        name: 'Луна',               mood: '🌙 Иллюзия',    shortMeaning: 'Страхи, подсознание, неопределённость',       advice: 'Не верь страхам — они не реальны',            image: '18_moon' },
  { id: 'sun',         name: 'Солнце',             mood: '☀️ Радость',    shortMeaning: 'Успех, ясность, жизненная сила',              advice: 'Сегодня — твой день. Свети!',                 image: '19_sun' },
  { id: 'judgement',   name: 'Суд',                mood: '🎺 Пробуждение', shortMeaning: 'Призыв, прощение, перерождение',             advice: 'Прости себя и начни заново',                  image: '20_judgement' },
  { id: 'world',       name: 'Мир',                mood: '🌍 Завершение', shortMeaning: 'Цикл завершён, интеграция, успех',            advice: 'Ты пришёл к целостности — отпразднуй это',    image: '21_world' },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function verifyTwitchJWT(token) {
  // In production: verify against Twitch Extension secret
  // For local testing, decode without verification
  try {
    const secret = process.env.TWITCH_SECRET;
    if (secret) {
      const buf = Buffer.from(secret, 'base64');
      return jwt.verify(token, buf);
    } else {
      // Local test mode: decode without verification
      return jwt.decode(token) || { opaque_user_id: 'test_user', channel_id: 'test_channel', role: 'viewer' };
    }
  } catch {
    return jwt.decode(token) || { opaque_user_id: 'test_user', channel_id: 'test_channel', role: 'viewer' };
  }
}

function broadcastToChannel(channelId, data) {
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client.channelId === channelId) {
      client.send(JSON.stringify(data));
    }
  });
}

function drawRandomCard() {
  return TAROT_DECK[Math.floor(Math.random() * TAROT_DECK.length)];
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  const payload = verifyTwitchJWT(auth.slice(7));
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  req.twitch = payload;
  next();
}

function broadcasterMiddleware(req, res, next) {
  if (req.twitch.role !== 'broadcaster' && req.twitch.role !== 'external') {
    return res.status(403).json({ error: 'Broadcaster only' });
  }
  next();
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Draw card
app.post('/api/draw', authMiddleware, (req, res) => {
  const userId = req.twitch.opaque_user_id;
  const channelId = req.twitch.channel_id;
  const now = Date.now();

  // Check cooldown
  const lastDraw = store.cooldowns[`draw_${userId}`] || 0;
  if (now - lastDraw < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (now - lastDraw)) / 1000);
    return res.status(429).json({ error: 'cooldown', remaining });
  }

  const card = drawRandomCard();
  const event = {
    id: crypto.randomUUID(),
    type: 'draw',
    userId,
    channelId,
    card,
    timestamp: now,
    status: 'new',
  };

  store.events.unshift(event);
  store.cooldowns[`draw_${userId}`] = now;

  // Notify dashboard
  broadcastToChannel(channelId, { type: 'new_event', event });

  res.json({ card, eventId: event.id });
});

// Submit question
app.post('/api/question', authMiddleware, (req, res) => {
  const userId = req.twitch.opaque_user_id;
  const channelId = req.twitch.channel_id;
  const { text } = req.body;
  const now = Date.now();

  if (!text || text.trim().length < 3) return res.status(400).json({ error: 'Question too short' });
  if (text.length > 280) return res.status(400).json({ error: 'Question too long' });

  const lastQ = store.cooldowns[`question_${userId}`] || 0;
  if (now - lastQ < QUESTION_COOLDOWN_MS) {
    const remaining = Math.ceil((QUESTION_COOLDOWN_MS - (now - lastQ)) / 1000);
    return res.status(429).json({ error: 'cooldown', remaining });
  }

  const question = {
    id: crypto.randomUUID(),
    type: 'question',
    userId,
    channelId,
    text: text.trim(),
    timestamp: now,
    status: 'pending',
  };

  store.questions.unshift(question);
  store.cooldowns[`question_${userId}`] = now;

  broadcastToChannel(channelId, { type: 'new_question', question });

  res.json({ success: true, questionId: question.id });
});

// Get events (dashboard)
app.get('/api/events/:channelId', authMiddleware, (req, res) => {
  const events = store.events.filter(e => e.channelId === req.params.channelId).slice(0, 50);
  res.json(events);
});

// Get questions (dashboard)
app.get('/api/questions/:channelId', authMiddleware, (req, res) => {
  const questions = store.questions.filter(q => q.channelId === req.params.channelId && q.status !== 'hidden').slice(0, 50);
  res.json(questions);
});

// Hide question (moderation)
app.patch('/api/questions/:id/hide', authMiddleware, (req, res) => {
  const q = store.questions.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Not found' });
  q.status = 'hidden';
  broadcastToChannel(q.channelId, { type: 'question_hidden', questionId: q.id });
  res.json({ success: true });
});

// Launch global card
app.post('/api/global/:channelId', authMiddleware, (req, res) => {
  const channelId = req.params.channelId;
  const card = drawRandomCard();
  const event = {
    id: crypto.randomUUID(),
    type: 'global',
    channelId,
    card,
    timestamp: Date.now(),
  };
  store.globalState[channelId] = event;
  broadcastToChannel(channelId, { type: 'global_card', event });
  res.json({ card, eventId: event.id });
});

// Highlight event on stream
app.post('/api/events/:id/highlight', authMiddleware, (req, res) => {
  const event = store.events.find(e => e.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Not found' });
  event.status = 'highlighted';
  broadcastToChannel(event.channelId, { type: 'highlight_event', event });
  res.json({ success: true });
});

// Get current global state
app.get('/api/global/:channelId', (req, res) => {
  res.json(store.globalState[req.params.channelId] || null);
});

// Get deck
app.get('/api/deck', (req, res) => res.json(TAROT_DECK));

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'ws://localhost');
  const channelId = url.searchParams.get('channelId') || 'test_channel';
  ws.channelId = channelId;
  ws.send(JSON.stringify({ type: 'connected', channelId }));
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🔮 Tarot API running on http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
});
