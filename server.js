import express from 'express';
import cors from 'cors';
import webpush from 'web-push';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 3000;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:example@example.com';
const DATA_FILE =
  process.env.DATA_FILE || path.join(process.cwd(), 'data', 'subscriptions.json');

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('[push] Faltan VAPID_PUBLIC_KEY y/o VAPID_PRIVATE_KEY.');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const app = express();
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors(allowedOrigins?.length ? { origin: allowedOrigins } : undefined));
app.use(express.json({ limit: '256kb' }));

/** @type {Array<{ endpoint: string, expirationTime?: number | null, keys: { p256dh: string, auth: string } }>} */
let subscriptions = [];

function isSubscription(value) {
  return Boolean(
    value &&
      typeof value.endpoint === 'string' &&
      value.keys &&
      typeof value.keys.p256dh === 'string' &&
      typeof value.keys.auth === 'string',
  );
}

async function loadSubscriptions() {
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    subscriptions = Array.isArray(parsed) ? parsed.filter(isSubscription) : [];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[push] No se pudo leer ${DATA_FILE}:`, error.message);
    }
    subscriptions = [];
  }
}

async function saveSubscriptions() {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(subscriptions, null, 2));
  await rename(tmp, DATA_FILE);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, subscriptions: subscriptions.length });
});

app.post('/api/subscribe', async (req, res) => {
  const subscription = req.body;

  if (!isSubscription(subscription)) {
    return res.status(400).json({ error: 'Suscripción inválida.' });
  }

  const index = subscriptions.findIndex((item) => item.endpoint === subscription.endpoint);
  if (index >= 0) {
    subscriptions[index] = subscription;
  } else {
    subscriptions.push(subscription);
  }

  try {
    await saveSubscriptions();
  } catch (error) {
    console.error('[push] Error guardando la suscripción:', error);
    return res.status(500).json({ error: 'No se pudo guardar la suscripción.' });
  }

  return res.status(201).json({ ok: true, total: subscriptions.length });
});

app.post('/api/push', async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';

  if (!title || !body) {
    return res.status(400).json({ error: 'title y body son obligatorios.' });
  }

  if (subscriptions.length === 0) {
    return res.json({ enviadas: 0, total: 0, eliminadas: 0 });
  }

  // Angular Service Worker espera exactamente { notification: { title, body, ... } }.
  const payload = JSON.stringify({
    notification: {
      title: title.slice(0, 120),
      body: body.slice(0, 300),
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-96x96.png',
      data: { url: '/' },
    },
  });

  const results = await Promise.allSettled(
    subscriptions.map((subscription) => webpush.sendNotification(subscription, payload)),
  );

  const expired = new Set();
  let enviadas = 0;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      enviadas += 1;
      return;
    }

    const statusCode = result.reason?.statusCode;
    const endpoint = subscriptions[index].endpoint;
    console.warn(`[push] Falló ${endpoint.slice(0, 70)}… (${statusCode ?? 'sin código'})`);

    // 404/410: la suscripción ya no existe. 403: fue creada con otra clave VAPID.
    if ([403, 404, 410].includes(statusCode)) {
      expired.add(endpoint);
    }
  });

  if (expired.size > 0) {
    subscriptions = subscriptions.filter((item) => !expired.has(item.endpoint));
    try {
      await saveSubscriptions();
    } catch (error) {
      console.error('[push] Error limpiando suscripciones caducadas:', error);
    }
  }

  return res.json({ enviadas, total: subscriptions.length, eliminadas: expired.size });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

app.use((error, _req, res, _next) => {
  console.error('[push] Error no controlado:', error);
  res.status(500).json({ error: 'Error interno.' });
});

await loadSubscriptions();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[push] Servidor escuchando en el puerto ${PORT}`);
  console.log(`[push] Suscripciones cargadas: ${subscriptions.length}`);
});
