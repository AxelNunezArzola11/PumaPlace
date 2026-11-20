# Anuncios (advertisement system)

Real, database-backed advertisements in the PumaPlace catalog. The public
storefront reads them from `GET /api/anuncios/activos`; everything else is
guarded by a dedicated service credential. There is no administrator user
role in this project, so ad management never rides on user JWTs.

## Public endpoint (no authentication)

`GET /api/anuncios/activos?placement=catalogo&limit=10`

- Returns only ads with `active = true` whose validity window contains
  "now" (`startAt IS NULL OR startAt <= now`, same for `endAt`).
- Returns an empty list when nothing is active — the frontend never
  invents placeholder ads.
- Public projection only: `id, title, description, imageUrl, targetUrl,
  advertiser, placement`. Scheduling (`active/startAt/endAt`) and
  timestamps are administrative and never exposed here.
- Query params: `placement` (optional: `catalogo`, `banner`, `lateral`),
  `limit` (optional integer 1–50, default 10).
- Rate limited: general `/api` bucket plus a dedicated `anuncios` bucket
  (300 req / 15 min per IP; `429` with `scope: "anuncios"` when exceeded).

## Administration (ADS_ADMIN_TOKEN only)

Every management endpoint requires the static service token from the
`ADS_ADMIN_TOKEN` environment variable as an `Authorization: Bearer`
credential. Ordinary buyer/seller/dual JWTs are always rejected with
`401`, and the unrelated `MAINTENANCE_TOKEN` is rejected too. When the
server token is missing or blank, every management endpoint fails closed
with `503` (`ADS_ADMIN_TOKEN_MISSING`) and executes nothing.

| Método | Ruta | Efecto |
|---|---|---|
| `GET` | `/api/anuncios` | Lists every ad, newest first. `limit` 1–100 (default 20), `page` (default 1). Full fields. |
| `GET` | `/api/anuncios/:id` | One ad with all fields, or `404`. |
| `POST` | `/api/anuncios` | Creates an ad (validated). `201` on success. |
| `PATCH` | `/api/anuncios/:id` | Edits fields, activates (`{"active": true}`) or deactivates (`{"active": false}`). |
| `DELETE` | `/api/anuncios/:id` | Deletes an ad. `204` on success, `404` when missing. |

### Provisioning the credential (required before managing ads)

Generate one token per environment and store it as `ADS_ADMIN_TOKEN`
(Render dashboard → `puma-place-api` → Environment for production; local
`.env` for development). Never commit the value.

```bash
openssl rand -hex 32
```

Without this step, ad management answers `503` — this is the expected
secure default, not an error.

### Examples (local development)

```bash
export ADS_ADMIN_TOKEN='<token-from-your-env>'

# Create
curl -s -X POST http://localhost:3000/api/anuncios \
  -H "Authorization: Bearer $ADS_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Promo estudiantes","description":"Descuento con credencial",
       "imageUrl":"https://example.com/img.png","targetUrl":"https://example.com/oferta",
       "advertiser":"Tienda X","placement":"catalogo","active":true}'

# Deactivate / activate
curl -s -X PATCH http://localhost:3000/api/anuncios/1 \
  -H "Authorization: Bearer $ADS_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"active":false}'

# Delete
curl -s -X DELETE http://localhost:3000/api/anuncios/1 \
  -H "Authorization: Bearer $ADS_ADMIN_TOKEN" -o /dev/null -w '%{http_code}\n'
```

### Validation rules (create and update share them)

- `title`, `advertiser`: required, non-blank, max 150 chars.
- `description`: optional text, max 2000 chars (`null`/empty clears it).
- `imageUrl`, `targetUrl`: required, max 2048 chars. HTTPS only; the
  only exception is `http://localhost|127.0.0.1|[::1]` outside
  production. Embedded credentials (`https://user:pass@…`) are rejected.
- `placement`: one of `catalogo`, `banner`, `lateral` (default `catalogo`).
- `active`: boolean (default `true`).
- `startAt`, `endAt`: optional dates; `startAt` must not be after `endAt`.
- Unknown fields are stripped and never persisted.

## First visible ad (secure seeding)

The house-ad seeder inserts exactly one clearly labeled PumaPlace house
ad — promoting PumaPlace itself, attributed to `PumaPlace (anuncio
interno)` — and only when it does not exist yet. Re-running is a no-op.
It needs direct database credentials (the same authorization model as
`db:migrate`); day-to-day management uses the HTTP endpoints above.

```bash
cd APIWeb-main
# Local MySQL (uses .env):
npm run ads:seed-house
# TiDB Cloud (inline credentials, never touching local .env):
DB_HOST='<tidb-host>' DB_PORT=4000 DB_USER='<usuario>' DB_PASSWORD='<pass>' \
  DB_NAME=pumaplace DB_SSL=true npm run ads:seed-house
# …or persistently via the ignored credentials file:
ENV_FILE=.env.tidb npm run ads:seed-house
```

Do not present any other company as a sponsor: only create third-party
ads under a real, authorized agreement, via the admin endpoints.

## Database and migration

- Table `anuncios` (Sequelize model `Anuncio`): `id, title, description,
  imageUrl, targetUrl, advertiser, placement, active, startAt, endAt,
  createdAt, updatedAt`.
- The change is additive and rerunnable: `npm run db:migrate` creates the
  table with `sequelize.sync()` (no alter/force), never modifies existing
  tables or data, and `npm run db:smoke` now expects 16/16 tables.
- Never run migration during Render build or startup: provision TiDB
  manually from your machine BEFORE deploying (see
  `docs/DEPLOY-RENDER.md` §2 step 5), then deploy the API first and the
  web service immediately afterward.

## Frontend wiring

- `AnuncioService.listarActivos()` calls the real public endpoint and
  validates every record (positive id, non-blank title/advertiser, HTTPS
  image and destination URLs); API failures yield `[]` so the catalog
  never breaks.
- `advertisementsEnabled` is `true` in `environment.ts` and in the
  build-time generated `environment.prod.ts`.
- `AnunciosComponent` renders above the product grid in
  `lista-productos`, with a `PUBLICIDAD` heading, a per-ad `ANUNCIO`
  badge, image, title, description, advertiser, and an external link to
  the validated destination (new tab, `noopener`). Loading and error
  states are shown inline; an empty response renders nothing.
