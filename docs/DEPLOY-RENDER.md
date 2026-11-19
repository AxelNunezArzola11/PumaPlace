# Puma Place — Deploy a Render + TiDB Cloud (sandbox público)

Guía completa para exponer Puma Place en pruebas sandbox públicas:

| Capa | Dónde | Qué |
|---|---|---|
| Frontend Angular 19 | Render Static Site | `puma-place-web`, SPA con `API_URL` inyectada en build |
| Backend Node/Express/Sequelize | Render Docker Web Service | `puma-place-api`, imagen endurecida no-root |
| Base de datos | TiDB Cloud Starter | MySQL-compatible, TLS obligatorio |
| Pagos | Mercado Pago Sandbox | Tokens `TEST-*`, sin dinero real |

El entorno local (MySQL 8 vía `compose.yml`) **no cambia**: esta guía solo añade
archivos y pasos nuevos. Blueprint: [`render.yaml`](../render.yaml).

---

## 1. Prerrequisitos

1. Cuenta de Render con permiso para crear Web Services y Static Sites.
2. Cluster **TiDB Cloud Starter** (capa gratuita) con un usuario SQL y su contraseña.
3. Cuenta de desarrollador de Mercado Pago con una aplicación de prueba
   (**Sandbox**, credenciales `TEST-…`). Nunca uses credenciales de producción.
4. Node.js 22 y Docker instalados localmente (para validar antes de desplegar).

---

## 2. TiDB Cloud: crear y preparar la base de datos

1. En [TiDB Cloud](https://tidbcloud.com) crea un cluster **Starter** (región
   cercana a tu región de Render, p. ej. `us-east-1` / Oregon según disponibilidad).
2. Crea la base de datos `pumaplace`:
   ```sql
   CREATE DATABASE IF NOT EXISTS pumaplace
     CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
   ```
3. Crea un usuario dedicado (no uses `root`) con acceso solo a `pumaplace`:
   ```sql
   CREATE USER 'pumaplace'@'%' IDENTIFIED BY '<contraseña-fuerte>';
   GRANT ALL PRIVILEGES ON pumaplace.* TO 'pumaplace'@'%';
   FLUSH PRIVILEGES;
   ```
   Anota el **host** del cluster (`<cluster>.tidbcloud.com`), el **puerto**
   (`4000`), el **usuario con su prefijo** si TiDB lo exige
   (p. ej. `<prefijo>.root`: se usa verbatim, sin dividirlo) y la contraseña.
4. TLS: TiDB Cloud exige conexiones cifradas. El backend impone
   `DB_SSL=true` en producción con TLSv1.2+ y verificación de certificado
   (`rejectUnauthorized: true`, sin forma de desactivarla). No necesitas
   subir un CA: por defecto se usan los CAs del sistema dentro del
   contenedor; solo define `DB_SSL_CA` (PEM inline o ruta) si tu cluster usa
   un CA privado.
5. **Migración MANUAL obligatoria (plan Free)**: los servicios Free de
   Render **no tienen pre-deploy commands ni one-off jobs**, así que el
   esquema de TiDB se crea desde tu máquina ANTES del primer despliegue.
   El backend nunca migra al arrancar y la imagen Docker nunca toca la base
   en su build. Ejecuta, desde la raíz del repo, con las credenciales de
   TiDB **en línea** (sin tocar tu `.env` local de MySQL: `dotenv` jamás
   sobrescribe variables ya exportadas):
   ```bash
   cd APIWeb-main
   # 5a. Verifica conexión y TLS contra TiDB (falla si algo está mal):
   DB_HOST='<tidb-host>' DB_PORT=4000 DB_USER='<usuario>' DB_PASSWORD='<pass>' \
     DB_NAME=pumaplace DB_SSL=true npm run db:smoke
   # 5b. Crea SOLO lo faltante (tablas + UNIQUE pagos.ordenId + categorías):
   DB_HOST='<tidb-host>' DB_PORT=4000 DB_USER='<usuario>' DB_PASSWORD='<pass>' \
     DB_NAME=pumaplace DB_SSL=true npm run db:migrate
   # 5c. Confirma el esquema final:
   DB_HOST='<tidb-host>' DB_PORT=4000 DB_USER='<usuario>' DB_PASSWORD='<pass>' \
     DB_NAME=pumaplace DB_SSL=true npm run db:smoke
   # Esperado: conexión OK, 14/14 tablas, TLS verificado, TODO OK.
   ```
   Protecciones: `db:migrate` imprime su destino (`host=`/`db=`, nunca la
   contraseña) y **se niega a correr contra `localhost`, `127.0.0.1`,
   `::1` o `mysql`** salvo `ALLOW_LOCAL_MIGRATE=true`, así que un descuido
   no puede tocar tu MySQL local. Es idempotente: `sync()` sin alter/force
   (solo crea tablas faltantes), el `UNIQUE` se añade únicamente si falta
   (verificado con `SHOW INDEX`) y las categorías usan `findOrCreate`.
   Re-ejecutarlo sobre una base existente es seguro y no modifica datos.
   Alternativa persistente: guarda las 6 variables en el archivo ignorado
   por Git `APIWeb-main/.env.tidb` (permisos `600`, comillas dobles
   permitidas en `DB_PASSWORD`) y usa `ENV_FILE=.env.tidb npm run db:smoke`
   o `ENV_FILE=.env.tidb npm run db:migrate` desde `APIWeb-main/` — ambos
   anuncian qué archivo cargaron (`entorno: …`) y fallan claro si no existe.
   Si el smoke test ya muestra 14/14 tablas, la migración inicial está
   hecha: omite 5b y repite solo la verificación 5c.

### 2.1 Auditoría de compatibilidad TiDB (evidencia, no suposiciones)

Verificado contra el DDL que genera Sequelize 6.37 (`attributeToSQL`) y el
código del repositorio:

| Construcción | Uso en Puma Place | Veredicto TiDB |
|---|---|---|
| `ENUM(...)` | `usuarios.rol/plan`, `productos.estado`, `ordenes.estado`, `pagos.metodo/planVendedor`, `carritos.estado`, `notificaciones.tipo`, `suscripciones.plan/estado` | ✅ Soportado (sintaxis MySQL idéntica) |
| `JSON NOT NULL` | `carritos.items`, `ordenes.lineas` | ✅ Soportado. Ojo documentado: el `defaultValue: []` del modelo **no** se emite como `DEFAULT` en DDL (MySQL lo prohíbe en JSON); Sequelize lo aplica a nivel aplicación al crear instancias. Comportamiento idéntico al MySQL 8 local |
| `DECIMAL(10,2)` | precios, montos, comisiones, descuentos | ✅ Soportado |
| `TEXT`, `STRING`, `DATE`, `BOOLEAN→TINYINT(1)`, `INTEGER.UNSIGNED` | todo el esquema | ✅ Soportados |
| `FOREIGN KEY … REFERENCES … ON DELETE/UPDATE CASCADE` | generadas por las asociaciones (`Pago→Orden`, `Orden→Usuario`, etc.) | ✅ Soportadas (TiDB soporta FKs con CASCADE) |
| Transacciones (`BEGIN/COMMIT` vía `sequelize.transaction`) | confirmación y cancelación de pagos en el webhook | ✅ Soportadas (TiDB es transaccional; modo pesimista por defecto) |
| `SHOW TABLES`, `SHOW INDEX`, `ADD CONSTRAINT … UNIQUE` | `db:smoke`, `db:migrate` | ✅ Soportados |
| `SHOW SESSION STATUS LIKE 'Ssl_cipher'` | verificación extra de TLS en `db:smoke` | ⚠️ TiDB puede no exponer esta fila: en ese caso el smoke test lo reporta y acepta, porque TLS ya está garantizado por el driver (`ssl.rejectUnauthorized=true` en `mysql2`: sin handshake TLS exitoso la conexión falla, no hay fallback a texto plano) |
| `SELECT … FOR UPDATE` | lectura de la orden en el webhook (serializa deliveries/cancelaciones concurrentes) | ✅ Soportado (TiDB usa transacciones pesimistas por defecto) |
| `LOCK TABLES`, procedimientos almacenados, triggers, vistas | — | ✅ No se usan en el código |
| `sequelize.sync()` en producción | — | ✅ Desactivado en `NODE_ENV=production`; el esquema lo crea `db:migrate` manual (§2 paso 5, sin alter/force) y el arranque nunca migra |

Límites operativos a recordar: el plan Starter pausa clusters inactivos (la
primera petición puede tardar segundos: ver §7 Cold starts) y limita
almacenamiento/conexiones; suficiente para sandbox, no para producción real.

---

## 3. Mercado Pago Sandbox

1. En [developers.mercadopago.com](https://www.mercadopago.com/developers),
   crea/usa una aplicación de prueba y copia el **Access Token de prueba**
   (`TEST-…`) → `MP_ACCESS_TOKEN`. **Nunca** uses un token de producción.
2. Configura el **secreto de firma del webhook** (el que firma el header
   `x-signature`) → `MP_WEBHOOK_SECRET`. Sin este secreto, en producción el
   endpoint `/api/pagos/webhook` responde `503` y **no procesa nada**
   (fail-closed); Mercado Pago reintenta, así que al configurarlo todo se
   recupera solo.
3. Registra la URL del webhook en tu aplicación:
   `https://puma-place-api.onrender.com/api/pagos/webhook` → `MP_WEBHOOK_URL`
   (debe ser HTTPS pública; el arranque la valida).
4. Las URLs de retorno (`MP_BACK_URL_*`) apuntan a las páginas de retorno del
   frontend (ver §6); ejemplo:
   `https://puma-place-web.onrender.com/pago/retorno/exito`.
5. Para probar pagos usa **usuarios y tarjetas de prueba** de Mercado Pago
   (documentación oficial: “tarjetas de prueba”). Ningún flujo del sandbox
   mueve dinero real.

Cómo se protege cada pago (implementado y con tests):

- **Firma**: el middleware `verifyMercadoPagoSignature` valida `x-signature`
  (`ts` fresco ±15 min + HMAC-SHA256 del manifiesto
  `id:{data.id};request-id:{x-request-id};ts:{ts};`) con comparación en
  tiempo constante. Firma inválida → `401`, sin tocar la base ni la API.
- **Re-consulta**: el backend ignora el payload de la notificación y obtiene
  el estado real con `payment.get({ id })`.
- **Monto exacto**: solo `approved` con `transaction_amount` idéntico al
  total calculado en backend confirma; cualquier diferencia → `422`.
- **Idempotencia**: verificación de estado dentro de la transacción +
  restricción `UNIQUE` en `pagos.ordenId`. Un reintento simultáneo o tardío
  responde `200 already-processed`, nunca duplica el cargo.
- **Atomicidad**: orden + pago + recibo + stock se confirman en **una
  transacción**; la cancelación por rechazo también es transaccional y libera
  la reserva.
- **Cancelaciones con claim condicional**: cancelar (usuario, fallo de
  preferencia, expiración) usa un `UPDATE … WHERE estado IN
  (pendiente,procesando)` atómico — solo un actor gana y solo el ganador
  libera stock; una cancelación jamás sobrescribe una orden `pagada`.
- **Expiración de reservas (TTL 30 min)**: las órdenes abiertas vencidas se
  cancelan y liberan stock vía (1) barrido piggyback en cada `POST
  /api/ordenes`, (2) chequeo perezoso en webhook/preferencia y (3) `POST
  /api/mantenimiento/expirar-reservas` para un cron externo gratuito
  (Render Free no tiene workers/cron propios). Sin infraestructura nueva.
- **Frontend honesto**: las páginas de retorno solo consultan el estado de
  la orden al backend (polling); jamás confirman con parámetros de la URL.

Tests pre-flight: `src/routes/__tests__/paymentWebhook.test.js`,
`src/routes/__tests__/webhookDelivery.test.js`,
`src/middlewares/__tests__/verifyMercadoPagoSignature.test.js`,
`src/use-cases/__tests__/Fixes.test.js` (reserva/restauración de stock),
`src/infrastructure/payments/__tests__/MercadoPagoGateway.test.js`.

---

## 4. Variables de entorno en Render

El backend valida todo al arrancar (`src/config/env.js`, `assertEnv()` en
`start()`): si falta algo o hay un valor inválido, el servicio **no arranca**
y el log lista solo NOMBRES de variables, nunca valores.

### 4.1 Backend (`puma-place-api`)

| Variable | Valor | Notas |
|---|---|---|
| `NODE_ENV` | `production` | Fijado en Dockerfile y Blueprint |
| `PORT` | `10000` | Puerto interno de Render |
| `DB_HOST` | `sync: false` | Host TiDB, p. ej. `<cluster>.tidbcloud.com` |
| `DB_PORT` | `4000` | Puerto TiDB Cloud |
| `DB_USER` | `sync: false` | Usuario TiDB verbatim (con prefijo si aplica) |
| `DB_PASSWORD` | `sync: false` | Secreto |
| `DB_NAME` | `pumaplace` | |
| `DB_SSL` | `true` | Obligatorio en producción |
| `DB_SSL_CA` | (opcional) | PEM inline o ruta; default: CAs del sistema |
| `JWT_SECRET` | `sync: false` | Secreto largo aleatorio |
| `JWT_EXPIRES_IN` | `24h` | |
| `ENCRYPTION_KEY` / `INDEX_KEY` | `sync: false` | 32 bytes aleatorios en base64 (`openssl rand -base64 32`) |
| `FRONTEND_URL` | `sync: false` | Origen exacto del frontend, sin `/` final. CORS de producción solo permite este origen |
| `MP_ACCESS_TOKEN` | `sync: false` | Token SANDBOX `TEST-…` |
| `MP_WEBHOOK_URL` | `sync: false` | `https://<api>/api/pagos/webhook` |
| `MP_WEBHOOK_SECRET` | `sync: false` | Secreto de firma `x-signature` |
| `MP_BACK_URL_SUCCESS/FAILURE/PENDING` | `sync: false` | `https://<web>/pago/retorno/exito\|fallo\|pendiente` |
| `RATE_LIMIT_WINDOW_MS` | (opcional, default `900000`) | Ventana del limitador en ms (1000–3600000) |
| `RATE_LIMIT_GENERAL_MAX` | (opcional, default `600`) | Peticiones /api por ventana e IP |
| `RATE_LIMIT_AUTH_MAX` | (opcional, default `20`) | Intentos de login por ventana e IP |
| `RATE_LIMIT_REGISTER_MAX` | (opcional, default `10`) | Registros por ventana e IP |
| `RATE_LIMIT_PREFERENCIA_MAX` | (opcional, default `30`) | Preferencias de pago por ventana e IP |

### 4.2 Frontend (`puma-place-web`)

| Variable | Valor | Notas |
|---|---|---|
| `API_URL` | `sync: false` | URL pública del backend **con** `/api`, p. ej. `https://puma-place-api.onrender.com/api`. Se inyecta en build vía `scripts/generate-environment.mjs`; si falta o es inválida, el build falla con mensaje claro |

---

## 5. Despliegue paso a paso

> Plan Free: Render **no ofrece pre-deploy commands ni one-off jobs** en
> servicios gratuitos. Por eso el Blueprint [`render.yaml`](../render.yaml)
> **no declara `preDeployCommand`** y el esquema se provisiona manualmente
> (paso 2). Si algún despliegue falla con
> `pre-deploy command is not supported for free tier services`, es porque
> quedó un comando pre-deploy configurado: quítalo del Blueprint (ya está
> quitado) **y** revisa el dashboard del servicio en
> Settings → Pre-Deploy Command: si tiene un valor manual, bórralo y guarda.

1. **TiDB primero** (§2 pasos 1–4): cluster, base `pumaplace`, usuario y
   contraseña. Copia host, puerto, usuario y contraseña: los usarás en el
   paso 2 y en el §4.
2. **Migra TiDB desde tu máquina** (§2 paso 5): `db:smoke` →
   `db:migrate` → `db:smoke` contra TiDB Cloud, con variables en línea.
   No continúes hasta ver `TODO OK` y `14/14 tablas`.
3. **Aplica el Blueprint**: Render Dashboard → New → Blueprint → selecciona
   el repositorio (usa [`render.yaml`](../render.yaml) en la raíz). Render
   crea `puma-place-api` (Docker, plan Free) y `puma-place-web` (Static).
4. **Rellena los `sync: false`** en el dashboard (ver §4). En este primer
   pase usa URLs tentativas `https://puma-place-api.onrender.com` y
   `https://puma-place-web.onrender.com` (ajústalas si Render asigna otros
   nombres). No configures ningún Pre-Deploy Command en Settings.
5. **Primer deploy**: el backend arranca con su comando normal de
   producción (`node src/index.js`, sin migraciones) y Render verifica
   `/health`. Revisa los logs: `Server listening on port …` sin errores
   de entorno.
6. **Cierra el círculo de URLs**: con las URLs reales asignadas por Render,
   actualiza `API_URL` (frontend), `FRONTEND_URL`, `MP_WEBHOOK_URL` y
   `MP_BACK_URL_*` (backend), registra el webhook en Mercado Pago (§3) y
   redeployea ambos servicios.
7. **Verifica** (§8): esquema (vía `db:smoke` local contra TiDB), health
   del backend, CORS y flujo de pago sandbox completo con tarjetas de
   prueba.

> Nota free-tier: los servicios gratuitos de Render se duermen por
> inactividad (§7). Para demos, “despiértalos” abriendo primero el frontend
> y esperando a que cargue antes de presentar el flujo de pago.

---

## 6. Frontend en Render (Static Site)

- **Build**: `npm ci && node scripts/generate-environment.mjs && npm run build
  -- --configuration production`. El generador escribe
  `src/environments/environment.prod.ts` desde `API_URL` y falla el build si
  falta, no es http(s) o no incluye `/api`. En local, `environment.prod.ts`
  es solo un fallback a `localhost` (nunca hardcodees URLs ahí).
- **Publicación**: `dist/proyecto-web/browser` (salida del application
  builder de Angular 19) con rewrite `/* → /index.html` para el router SPA.
- **Rutas de retorno de pago**: `/pago/retorno/exito`, `/pago/retorno/fallo`,
  `/pago/retorno/pendiente` (componente `RetornoPagoComponent`). Leen el
  `external_reference` (= id de orden) de la query, ignoran cualquier estado
  que venga en la URL y muestran el veredicto consultando al backend cada
  4 s hasta 5 min. La página `/pago` (checkout en popup) usa el mismo
  polling contra `GET /api/ordenes/:id`.
- **Reintentos seguros**: `RetryInterceptor` reintenta solo `GET` ante
  fallos de red o `408/429/502/503/504` (backoff 500 ms → 1 s → 2 s, máx.
  3 intentos). Las escrituras (`POST` de órdenes/preferencias/pagos) jamás
  se reintentan solas: repetirlas podría cobrar dos veces.
- El `Dockerfile`/`nginx.conf` del frontend se conserva para despliegues
  contenerizados propios; Render Static **no** los usa.

## 7. Cold starts (Render free-tier + TiDB Starter)

Qué esperar y cómo está cubierto:

| Situación | Comportamiento | Mitigación implementada |
|---|---|---|
| Servicio Render dormido (sin tráfico ~15 min) | primera petición tarda 30–60 s (502/503 intermedios posibles) | `healthCheckPath: /health` (liveness rápido, sin DB); reintentos GET en frontend; polling de pago tolerante a fallos transitorios |
| TiDB Starter pausado | primera conexión lenta o rechazada | `connectWithRetry` (10 intentos × 5 s) antes de escuchar; el contenedor no recibe tráfico hasta conectar |
| Build de Render | genera `environment.prod.ts`, compila Angular | falla rápido con mensaje claro si `API_URL` es inválida |

Si un pago queda en “verificando” durante un cold start, no se pierde: el
webhook de Mercado Pago reintenta la entrega y el backend lo procesa
idempotente al despertar; el frontend sigue consultando hasta 5 minutos.

## 8. Verificación post-despliegue

Ejecuta en orden (reemplaza `<api>` y `<web>` por tus URLs):

```bash
# 1. Liveness del backend (siempre rápido, sin DB)
curl -s https://<api>/health
# → {"status":"ok"}

# 2. Esquema verificado: repite el smoke test LOCAL contra TiDB (§2 paso 5c).
#    Debe seguir en 14/14 tablas: el deploy no toca el esquema.
DB_HOST='<tidb-host>' DB_PORT=4000 DB_USER='<usuario>' DB_PASSWORD='<pass>' \
  DB_NAME=pumaplace DB_SSL=true npm run db:smoke --prefix APIWeb-main
# → conexión OK, 14/14 tablas, TLS verificado, TODO OK

# 3. CORS restringido: origen ajeno → 403
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://evil.example' \
  https://<api>/api/categorias
# → 403

# 4. CORS permitido: tu frontend → 200 (en rutas públicas)
curl -s -o /dev/null -w '%{http_code}\n' -H "Origin: https://<web>" \
  https://<api>/api/categorias
# → 200

# 5. Webhook sin firma → 401 (nada se procesa)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<api>/api/pagos/webhook \
  -H 'Content-Type: application/json' -d '{"data":{"id":"1"}}'
# → 401
```

6. Flujo E2E sandbox: regístrate en `https://<web>`, publica un producto
   (vendedor), cómpralo (comprador), paga con tarjeta de prueba aprobada,
   vuelve por `/pago/retorno/exito` y confirma que la orden queda `pagada`.
   Repite con tarjeta rechazada → orden `cancelada` y stock liberado.
7. Revisa los logs del backend: sin stack traces, sin secretos impresos.

## 9. Rollback

- **Backend/frontend**: Render Dashboard → servicio → Deploys → redeploy de
  un deploy anterior sano. Las migraciones son aditivas (`sync` sin alter,
  `UNIQUE` y categorías idempotentes), así que volver atrás no rompe datos.
- **Base de datos**: TiDB Cloud conserva backups automáticos del cluster;
  restaura desde su consola si un despliegue corrompiera datos (las
  pre-condiciones lo hacen improbable: nada aquí borra tablas ni columnas).
- **Versionado**: cada cambio de despliegue viaja en rama
  `feature/deploy-render-tidb`; no se mergea ni se abre PR sin revisión.

## 10. Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| `pre-deploy command is not supported for free tier services` | Comando pre-deploy residual en Settings del servicio (el Blueprint ya no declara ninguno) | Vacía Settings → Pre-Deploy Command, guarda y redeployea (ver §5) |
| El API no arranca: `Faltan variables de entorno…` | `sync: false` sin rellenar | Completa las vars del §4.1 y redeployea |
| `DB_SSL debe ser "true" en producción` | `DB_SSL=false` en Render | Pon `DB_SSL=true` (TiDB exige TLS) |
| `self-signed certificate` / `unable to verify` | CA del sistema incompleto en Slim | Define `DB_SSL_CA` con el PEM de TiDB |
| Frontend llama a `localhost:3000` | `API_URL` vacía en build | Define `API_URL=https://<api>/api` y rebuild (el generador falla si es inválida) |
| CORS `403` en el frontend real | `FRONTEND_URL` ≠ origen exacto | Sin `/` final, con `https://`, redeploy backend |
| Webhook `503 WEBHOOK_SECRET_MISSING` | falta `MP_WEBHOOK_SECRET` | Configúralo; MP reintenta solo |
| Webhook `401` siempre | secreto distinto al de la app MP | Copia el secreto exacto de la app de Mercado Pago |
| Orden eternamente `pendiente` | webhook no llega (URL mal registrada) | Verifica `MP_WEBHOOK_URL` y el registro en la app MP; revisa los reintentos en el panel de MP. La reserva se libera sola a los 30 min (barrido piggyback + endpoint de expiración) |
| Doble notificación de Mercado Pago | reintento de delivery (mismo `data.id`) | Esperado: el segundo responde `200 already-processed` (idempotencia + backstop `UNIQUE`); un solo cargo |
| Primera carga muy lenta | cold start (§7) | Normal en free-tier; reintenta tras 60 s |

## 11. Desarrollo local (sin cambios)

```bash
docker compose up --build        # API :3000 + MySQL 8 + frontend :4200
cd APIWeb-main && npm test       # suite backend (jest)
cd APIWeb-main && npm run db:smoke   # requiere la DB local arriba
cd WebProject-main/ProyectoWeb && npm run build -- --configuration production
docker compose config            # valida el compose sin levantarlo
```

`compose.yml`, el `Dockerfile` de desarrollo y el flujo `localhost` quedan
intactos: el `Dockerfile` backend multi-stage también sirve a compose
(la app solo necesita dependencias de producción para `node src/index.js`).

---

## 12. Autorización y rate limiting

### 12.1 Políticas de ownership (deny-by-default)

No existe un rol administrador: cada mutación exige ownership verificado
server-side, y lo que no tiene política legítima no tiene ruta (404).

| Recurso | PATCH | DELETE |
|---|---|---|
| usuarios | Solo `edad`, solo propia (`rol`/`plan` se ignoran; rol vía `/:id/vendedor`) | Sin ruta |
| ordenes | Solo `puntoEntrega`, solo comprador | Sin ruta: usar `POST /ordenes/:id/cancelar` (libera reserva vía `ORDER_CANCELLED`) |
| pagos, recibos | Sin ruta | Sin ruta: historial financiero inmutable |
| carrito | Sin ruta genérica (usar `/items`, `/activo`, `/abandonar` con ownership) | Sin ruta |
| productos | Solo dueño (`productOwner`) | Solo dueño: el ÚNICO DELETE genérico |
| inventario | Solo `cantidadDisponible`, solo vendedor del producto (`cantidadReservada` nunca editable) | Sin ruta (se crea al publicar) |
| categorias | Sin ruta (lectura pública) | Sin ruta |
| notificaciones | Solo `enviada`, solo destinatario | Sin ruta |
| seguimiento-stock | Solo `activo`, solo seguidor (creación forzada al caller) | Sin ruta |
| cupones, suscripciones | Sin ruta | Sin ruta |

### 12.2 Rate limiting (Render Free, 1 instancia)

Middleware `express-rate-limit` (in-memory; correcto para 1 instancia, se
reinicia con cada deploy/sleep y no se compartiría si se escalara).
`trust proxy` vale exactamente `1` (el único reverse proxy de Render):
nunca `true`, para que `X-Forwarded-For` falsificado no evasione límites.

| Ámbito | Límite default / 15 min |
|---|---|
| General `/api` | 600 (cubre polling 4s + navegación; 2 pestañas activas ≈ 450) |
| `POST /api/auth/login` | 20 |
| `POST /api/auth/register` | 10 |
| `POST /api/pagos/preferencia` | 30 |

Excluidos siempre: `GET /health` (fuera de los mounts), `POST
/api/pagos/webhook` (los reintentos de Mercado Pago jamás deben ver un
429; la firma es su protección) y preflights `OPTIONS`. Exceder devuelve
`429` JSON `{success:false, code:'RATE_LIMITED'}` con header `Retry-After`.
Tuning vía `RATE_LIMIT_*` (§4.1, validados al arrancar).

### 12.3 Pendiente para apertura pública (no bloquea sandbox confiable)

- Lecturas cruzadas aún abiertas: `GET /api/pagos`, `/cupones`,
  `/notificaciones`, `/seguimiento-stock`, `/suscripciones`, `/carrito`
  listan/leen registros ajenos (privacidad, sin efecto en pagos/stock).
- `POST /api/categorias` y `POST /api/inventario`: denegados (sin ruta,
  sin flujo legítimo). `POST /api/cupones`: flujo heredado incoherente sin
  uso real; revisar si se necesita escritorio administrativo (implicaría
  diseñar un rol admin).
- Endurecer límites si hay abuso real; considerar store distribuido solo
  si se sale del plan Free de 1 instancia.

---

*Última actualización: rama `feature/deploy-render-tidb`. Sandbox solamente:
prohibido usar credenciales de producción, cobrar dinero real o tocar
recursos productivos externos desde este despliegue.*

