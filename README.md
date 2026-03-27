# 🔮 Tarot Twitch Extension — Полный MVP

Интерактивное Twitch-расширение формата Video Overlay с таро-механиками.

---

## Состав проекта

```
tarot-twitch/
├── api/               ← API-сервер (Node.js + Express + WebSocket)
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── overlay/           ← Viewer Overlay (загружается в Twitch iframe)
│   └── overlay.html
├── dashboard/         ← Стример Dashboard (отдельная веб-панель)
│   └── dashboard.html
├── docker-compose.yml
├── extension.json     ← Twitch Extension manifest
└── README.md
```

---

## Быстрый старт (локальный тест)

### 1. Запуск API-сервера

```bash
cd api
npm install
node server.js
# API работает на http://localhost:3001
```

### 2. Открыть Dashboard

Открой в браузере: `dashboard/dashboard.html`  
(или `http://localhost:3002` если через Docker)

### 3. Открыть Overlay для теста

Открой в браузере: `overlay/overlay.html`

---

## Подключение к Twitch

### Шаг 1 — Создать расширение на Twitch

1. Зайди на https://dev.twitch.tv/console/extensions
2. Нажми **Create Extension**
3. Тип: **Video Overlay**
4. Запомни **Extension Client ID** и **Extension Secret**

### Шаг 2 — Настроить URL файлов расширения

В настройках расширения (вкладка **Asset Hosting**):

| View | URL |
|------|-----|
| Video Overlay | `https://ТВОЙ_ДОМЕН/overlay/overlay.html` |

> Twitch требует **HTTPS**. Для локального теста используй [Twitch CLI](https://dev.twitch.tv/docs/cli) или [ngrok](https://ngrok.com/).

### Шаг 3 — Для локального теста через Twitch CLI

```bash
# Установи Twitch CLI
brew install twitchdev/twitch/twitch-cli   # macOS
# или скачай с https://github.com/twitchdev/twitch-cli/releases

# Авторизуйся
twitch configure

# Запусти локальный Extension Server
twitch extension serve \
  --port 8080 \
  --frontend-folder ./overlay \
  --backend-url http://localhost:3001
```

Потом в Twitch Dev Console:
- Укажи Local Test URL: `https://localhost:8080`
- Активируй расширение на своём канале (Local Test)

### Шаг 4 — Развернуть API на сервере

Самый простой вариант — [Railway](https://railway.app) или [Render](https://render.com):

```bash
# Railway
railway init
railway up

# Или Docker
docker-compose up -d
```

Установи переменную окружения:
```
TWITCH_SECRET=<твой Extension Secret в base64>
```

### Шаг 5 — Указать URL API в overlay.html

В `overlay/overlay.html` найди строку:
```js
const API_BASE = window.TAROT_API_URL || 'http://localhost:3001';
```

Замени на URL твоего сервера:
```js
const API_BASE = 'https://твой-сервер.railway.app';
```

---

## API Endpoints

| Method | URL | Описание |
|--------|-----|----------|
| POST | `/api/draw` | Вытянуть карту (требует JWT) |
| POST | `/api/question` | Отправить вопрос (требует JWT) |
| GET  | `/api/events/:channelId` | Список событий (dashboard) |
| GET  | `/api/questions/:channelId` | Список вопросов (dashboard) |
| PATCH | `/api/questions/:id/hide` | Скрыть вопрос |
| POST | `/api/global/:channelId` | Запустить глобальную карту |
| POST | `/api/events/:id/highlight` | Выделить событие на стриме |
| GET  | `/api/deck` | Полная колода |
| GET  | `/health` | Статус сервера |

WebSocket: `ws://localhost:3001?channelId=CHANNEL_ID`

---

## Функции MVP

### Viewer Overlay
- ✅ Компактная кнопка в правом нижнем углу
- ✅ Разворачиваемая панель
- ✅ Вытягивание случайной карты с анимацией флипа
- ✅ Краткая интерпретация (настроение, значение, совет)
- ✅ Cooldown (5 минут по умолчанию) с таймером
- ✅ Форма отправки вопроса стримеру
- ✅ Глобальный баннер при коллективной карте (WebSocket)
- ✅ Частицы и визуальные эффекты

### Streamer Dashboard
- ✅ Поток событий зрителей в реальном времени (WebSocket)
- ✅ Очередь вопросов с модерацией
- ✅ Кнопка "Показать на экране" (highlight)
- ✅ Запуск глобальной карты для всего чата
- ✅ Фильтры по статусу событий
- ✅ Авто-обновление каждые 30 секунд

### API Server
- ✅ Все 22 карты Старших Арканов с описаниями на русском
- ✅ JWT-валидация токенов Twitch
- ✅ Cooldown per-user (раздельно для карт и вопросов)
- ✅ WebSocket для real-time уведомлений
- ✅ Защита от спама (длина текста, cooldown)
- ✅ Docker + docker-compose

---

## Настройка cooldown

В `api/server.js`:
```js
const COOLDOWN_MS = 5 * 60 * 1000;         // 5 минут между картами
const QUESTION_COOLDOWN_MS = 3 * 60 * 1000; // 3 минуты между вопросами
```

---

## Следующие шаги (post-MVP)

- [ ] База данных (PostgreSQL / Redis) вместо in-memory
- [ ] Авторизация стримера через Twitch OAuth
- [ ] Колоды Младших Арканов
- [ ] Расклады (3 карты, кельтский крест)
- [ ] Анимированные изображения карт
- [ ] Twitch Bits монетизация
- [ ] Panel / Component views
- [ ] Статистика и история гаданий
