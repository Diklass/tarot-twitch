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

// ─── NUMEROLOGY ───────────────────────────────────────────────────────────────
const NUMBERS = [
  { value: 1,  name: 'Единица',   energy: 'начало, импульс, исток',           form: 'всё начинается с нуля — первый шаг, первый сигнал, первый выбор' },
  { value: 2,  name: 'Двойка',    energy: 'дуальность, ожидание, выбор',      form: 'энергия раздвоена — два пути, два голоса, две стороны одного' },
  { value: 3,  name: 'Тройка',    energy: 'рост, творчество, выражение',      form: 'энергия ищет выход — через слово, идею, творческий акт' },
  { value: 4,  name: 'Четвёрка',  energy: 'структура, стабильность, фундамент', form: 'энергия хочет оформиться — осесть, закрепиться, стать реальной' },
  { value: 5,  name: 'Пятёрка',   energy: 'движение, перемена, вызов',        form: 'энергия не стоит на месте — она расшатывает, ломает, ведёт вперёд' },
  { value: 6,  name: 'Шестёрка',  energy: 'гармония, забота, ответственность', form: 'энергия ищет баланса — между собой и другими, между давать и брать' },
  { value: 7,  name: 'Семёрка',   energy: 'поиск, мистика, углубление',       form: 'энергия уходит внутрь — в вопросы без очевидных ответов' },
  { value: 8,  name: 'Восьмёрка', energy: 'сила, давление, напряжение',       form: 'энергия давит и требует — она не терпит слабости или промедления' },
  { value: 9,  name: 'Девятка',   energy: 'завершение, мудрость, отпускание', form: 'энергия подводит итог — цикл почти замкнулся, пора отпустить' },
  { value: 11, name: 'Одиннадцать', energy: 'интуиция, озарение, сверхчувственность', form: 'энергия приходит вспышками — как знак, как сон, как внутренний голос' },
  { value: 22, name: 'Двадцать два', energy: 'мастерство, большой план, воплощение', form: 'энергия строит — не мелкое, а настоящее, долгосрочное, масштабное' },
];

// ─── COLORS ───────────────────────────────────────────────────────────────────
// Named color palette with meanings for richer interpretations
const COLOR_MEANINGS = {
  red:    { keywords: ['страсть, огонь, решительность'], tone: 'горячий и настойчивый' },
  orange: { keywords: ['вдохновение, азарт, энергия'], tone: 'живой и воодушевляющий' },
  yellow: { keywords: ['ясность, свет, оптимизм'], tone: 'яркий и открытый' },
  green:  { keywords: ['рост, исцеление, природа'], tone: 'мягкий и восстанавливающий' },
  teal:   { keywords: ['равновесие, ясность, мудрость'], tone: 'спокойный и ясный' },
  blue:   { keywords: ['глубина, серьёзность, внутренняя работа'], tone: 'глубокий и сосредоточенный' },
  indigo: { keywords: ['интуиция, мистика, тайное знание'], tone: 'таинственный и проникновенный' },
  violet: { keywords: ['трансформация, духовность, поиск'], tone: 'возвышенный и ищущий' },
  pink:   { keywords: ['нежность, симпатия, уязвимость'], tone: 'мягкий и эмоциональный' },
  rose:   { keywords: ['любовь, тепло, открытость сердца'], tone: 'тёплый и сердечный' },
  gold:   { keywords: ['ценность, свет, значимость момента'], tone: 'торжественный и значимый' },
  silver: { keywords: ['интуиция, луна, отражение'], tone: 'лунный и переменчивый' },
  white:  { keywords: ['чистота, начало, пустота до формы'], tone: 'чистый и незаполненный' },
  black:  { keywords: ['глубина, тень, то что скрыто'], tone: 'тёмный и требующий внимания' },
  brown:  { keywords: ['земля, практичность, укоренённость'], tone: 'земной и практичный' },
};

function randomColor() {
  // Generate fully random RGB hex
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

  // Classify color for meaning
  const meaning = classifyColor(r, g, b);
  return { hex, r, g, b, ...meaning };
}

function classifyColor(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2 / 255;
  const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));

  if (lightness > 0.85) return { name: 'white', ...COLOR_MEANINGS.white };
  if (lightness < 0.15) return { name: 'black', ...COLOR_MEANINGS.black };
  if (saturation < 0.15) return lightness > 0.5 ? { name: 'silver', ...COLOR_MEANINGS.silver } : { name: 'brown', ...COLOR_MEANINGS.brown };

  // Hue detection
  const hue = rgbToHue(r, g, b);
  if (hue < 15 || hue >= 345)  return { name: 'red', ...COLOR_MEANINGS.red };
  if (hue < 40)                return { name: 'orange', ...COLOR_MEANINGS.orange };
  if (hue < 65)                return { name: 'yellow', ...COLOR_MEANINGS.yellow };
  if (hue < 150)               return { name: 'green', ...COLOR_MEANINGS.green };
  if (hue < 185)               return { name: 'teal', ...COLOR_MEANINGS.teal };
  if (hue < 220)               return lightness < 0.35 ? { name: 'indigo', ...COLOR_MEANINGS.indigo } : { name: 'blue', ...COLOR_MEANINGS.blue };
  if (hue < 260)               return { name: 'violet', ...COLOR_MEANINGS.violet };
  if (hue < 290)               return { name: 'violet', ...COLOR_MEANINGS.violet };
  if (hue < 320)               return lightness > 0.55 ? { name: 'pink', ...COLOR_MEANINGS.pink } : { name: 'rose', ...COLOR_MEANINGS.rose };
  if (hue < 345)               return { name: 'rose', ...COLOR_MEANINGS.rose };
  return { name: 'red', ...COLOR_MEANINGS.red };
}

function rgbToHue(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return Math.round(h * 360);
}

function randomNumber() {
  return NUMBERS[Math.floor(Math.random() * NUMBERS.length)];
}

// ─── READING GENERATOR ────────────────────────────────────────────────────────
function generateReading(number, card, color) {
  const parts = [
    `${number.name} — это ${number.energy}. ${number.form}.`,
    `${card.name} — ${card.shortMeaning.toLowerCase()}.`,
    `${color.tone.charAt(0).toUpperCase() + color.tone.slice(1)} цвет ${color.hex} говорит: всё это проходит через ${color.keywords[0]}.`,
  ];

  // Synthesis
  const synthesis = buildSynthesis(number, card, color);
  parts.push(synthesis);

  return parts.join(' ');
}

function buildSynthesis(number, card, color) {
  // A few synthesis templates to vary the output
  const templates = [
    `Значит, прямо сейчас в твоей жизни ${card.advice.toLowerCase()} — и это окрашено в ${color.tone} тон.`,
    `Совет карт: ${card.advice.toLowerCase()}. ${number.name} подтверждает: момент пришёл.`,
    `${number.name} задаёт ритм, ${card.name} — тему, а ${color.hex} — эмоциональный фон. Вместе они говорят: ${card.advice.toLowerCase()}.`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

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

  // Three independent rolls
  const number = randomNumber();
  const card   = drawRandomCard();
  const color  = randomColor();
  const reading = generateReading(number, card, color);

  const event = {
    id: crypto.randomUUID(),
    type: 'draw',
    userId,
    channelId,
    number,
    card,
    color,
    reading,
    timestamp: now,
    status: 'new',
  };

  store.events.unshift(event);
  store.cooldowns[`draw_${userId}`] = now;

  // Notify dashboard
  broadcastToChannel(channelId, { type: 'new_event', event });

  res.json({ number, card, color, reading, eventId: event.id });
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
