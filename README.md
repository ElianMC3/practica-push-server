# Servidor de notificaciones push (Render)

Servidor mínimo compatible con la PWA Angular de FakeStore. Es un proyecto
independiente: la PWA solo necesita la URL del servicio y la clave pública
VAPID. Sustituye al servidor del profesor y usa **tus propias claves**.

## Contrato con la PWA

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| `GET` | `/api/health` | — | `{ ok, subscriptions }` |
| `POST` | `/api/subscribe` | `PushSubscription` del navegador | `{ ok, total }` |
| `POST` | `/api/push` | `{ "title": "...", "body": "..." }` | `{ enviadas, total, eliminadas }` |

El servidor envía a Web Push exactamente:

```json
{
  "notification": {
    "title": "Elian Medina - 20233L001162",
    "body": "Eliminó a john doe"
  }
}
```

Ese formato es obligatorio: el service worker de Angular solo muestra la
notificación si el payload trae `notification.title`.

## 1. Generar tus claves VAPID (local)

```bash
cd practica-push-server
npm install
npm run keys
```

Guarda la **clave pública** y la **clave privada**. La privada no se sube a
GitHub ni se pone en el frontend.

## 2. Probar en local

```bash
cp .env.example .env
# edita .env con tus claves y tu correo
npm run dev
```

Comprueba:

```bash
curl http://localhost:3000/api/health
# {"ok":true,"subscriptions":0}
```

Para probar desde la PWA en local, cambia temporalmente
`src/app/core/push.config.ts` a:

```ts
export const VAPID_PUBLIC_KEY = 'TU_CLAVE_PUBLICA';
export const PUSH_API_URL = 'http://localhost:3000/api';
```

`ng serve` no registra el service worker (solo producción). Para probar push
de verdad compila y sirve la PWA en localhost:

```bash
npm run build
npx http-server -p 8080 -c-1 dist/practica-cahe-api/browser
```

Abre `http://localhost:8080`, pulsa **Activar avisos** y luego
**Test Notificacion**.

## 3. Subir el servidor a GitHub

El repo ya está inicializado y con el primer commit. Solo falta crear el
repositorio en GitHub y conectar el remoto:

```bash
git remote add origin https://github.com/TU_USUARIO/practica-push-server.git
git push -u origin main
```

El `.gitignore` del proyecto excluye `node_modules`, `.env` y `data/`.

## 4. Crear el Web Service en Render

1. Entra a <https://dashboard.render.com> → **New** → **Web Service**.
2. Conecta tu repositorio de GitHub.
3. Rellena:

   | Campo | Valor |
   |---|---|
   | Name | `practica-push-server` |
   | Language | `Node` |
   | Root Directory | *(vacío)* |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | `Free` |
   | Health Check Path | `/api/health` |

4. En **Environment Variables** añade:

   | Variable | Valor |
   |---|---|
   | `VAPID_PUBLIC_KEY` | tu clave pública |
   | `VAPID_PRIVATE_KEY` | tu clave privada |
   | `VAPID_SUBJECT` | `mailto:tu-correo@ejemplo.com` |
   | `ALLOWED_ORIGINS` | opcional: `http://localhost:4200,https://tu-pwa.onrender.com` |

   No definas `PORT`: Render lo inyecta.

5. **Create Web Service** y espera el deploy.
6. Copia la URL, por ejemplo `https://practica-push-server.onrender.com`.

Comprueba:

```bash
curl https://practica-push-server.onrender.com/api/health
```

## 5. Apuntar la PWA a tu servidor

Edita `src/app/core/push.config.ts`:

```ts
export const VAPID_PUBLIC_KEY = 'TU_CLAVE_PUBLICA';
export const PUSH_API_URL = 'https://practica-push-server.onrender.com/api';
```

Vuelve a compilar y desplegar la PWA.

### Migrar la suscripción anterior

La suscripción actual está atada a la clave VAPID del profesor. Al cambiar la
clave hay que renovarla:

1. Abre la PWA y pulsa **Desactivar avisos** (si estaba activa).
2. Recarga y pulsa **Activar avisos**.

Si falla, en DevTools → **Application** → **Service Workers** usa
**Unregister** y **Clear site data**, recarga y vuelve a activar.

## 6. Verificar de punta a punta

1. `GET /api/health` debe subir `subscriptions` a 1 al activar avisos.
2. **Test Notificacion** debe mostrar la notificación del navegador.
3. En **Usuarios**, crear/editar/eliminar debe mostrar
   `Elian Medina - 20233L001162` y la acción.

## Notas de Render (plan Free)

- El servicio se duerme tras ~15 minutos sin tráfico. La primera petición puede
  tardar ~30-60 s en despertarlo.
- El sistema de archivos es **efímero**: `data/subscriptions.json` se pierde en
  cada deploy o reinicio. Las suscripciones dejarán de existir y habrá que
  pulsar **Activar avisos** otra vez.
- Si necesitas persistencia real, usa una base de datos gratuita (Render
  Postgres/Key Value, Neon, Supabase o Upstash) y guarda ahí las suscripciones.
- El endpoint `/api/push` es público: cualquiera con la URL puede lanzar
  notificaciones. Para una práctica es aceptable; para producción añade un
  token (`Authorization: Bearer ...`) y envíalo desde la PWA.
- Render sirve HTTPS automáticamente, requisito de Web Push.
