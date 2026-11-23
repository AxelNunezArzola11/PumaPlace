# Instructions for GitHub Copilot (agent mode) — Puma Place Backend

## Context

Puma Place is a marketplace for used items between UNAM students, with a free plan and a premium plan. The backend lives in `APIWeb-main/` and must meet the course's integration deliverables:

1. A RESTful API.
2. Standard technical documentation (OpenAPI / Swagger).
3. Payment gateway integration in sandbox mode (Mercado Pago).

## Current repo state (verify it in Step 0, do not assume it)

- The domain layer already exists in `APIWeb-main/src/domain/entities/` with its tests in `__tests__/`: `Usuario`, `Inventario`, `Carrito`, `Cupon`, `Notificacion`, `SeguimientoStock`, `Orden`, `Pago`, `ReciboTransaccion`.
- Docker already uses `node:22`. There is a `compose.yml` at the repo root (services `backend` and `mysql`; `frontend` may be commented out).
- CI exists in `.github/workflows/ci.yml` and runs `npm ci` and `npm run test:ci` inside `APIWeb-main`.
- Depending on which steps are already merged, some of these may not exist yet: Sequelize and the Express server (Step 1), the EventBus, use cases, routes, Swagger, and the payment gateway. Check the repo and skip anything already done.

## Mandatory rules

- Plain JavaScript, CommonJS (`require` / `module.exports`). **No TypeScript.**
- Stack versions (do not change without asking): `express ^4.18.2`, `sequelize ^6.37.7`, `mysql2 ^3.14.1`, `bcryptjs ^3.0.2`, `jsonwebtoken ^9.0.2`, `cors ^2.8.5`, `dotenv ^16.5.0`; dev: `nodemon`, `jest`.
- `src/domain/` must NOT import Express, Sequelize, or the payment gateway SDK. Inner layers never depend on outer layers.
- **Do not modify the logic of the 9 existing entities** without asking first. If an entity needs something new, propose it before changing it.
- An `Orden` total is always computed on the backend (`Orden.calcularTotal()`), never from a value sent by the client.
- A payment is marked as confirmed only when the gateway's webhook confirms it, never based on what the frontend says.
- No VAT and no shipping cost (deliveries happen at safe meeting points on campus). The business earns revenue from the free-plan commission (10%, only when the gateway is used) and from the premium subscription.
- Credentials always come from environment variables (`.env`, git-ignored). Keep a `.env.example` with variable names and fake values.
- Workflow: one `feature/<name>` branch per step, PR into `develop`. Never push to `main`.
- Before every commit: `npm run test:ci` must pass.

## Target structure (inside `APIWeb-main/src/`)

```
config/database.js
domain/entities/            ← already exists
domain/events/EventBus.js
use-cases/
infrastructure/
  models/                   ← Sequelize models
  repositories/             ← translate Sequelize model ↔ domain entity
  payments/MercadoPagoGateway.js
  notifications/            ← listeners (Observer)
controllers/
routes/
middlewares/
docs/openapi.yaml
seeders/
index.js
```

## Steps (run in order; one PR per step)

### Step 0 — Verify (read-only)
List what exists in `APIWeb-main/`, run `npm ci` and `npm run test:ci`, and confirm `package.json` has the `test:ci` script (add it if missing, e.g. `jest --ci --coverage`). Report what is missing before writing any code.

### Step 1 — Sequelize and base server
- Install the dependencies listed in the stack above.
- `config/database.js`: connection using `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- One Sequelize model per concept, named in Spanish to match the domain entities: `Usuario`, `Categoria`, `Producto`, `Inventario`, `Carrito`, `ItemCarrito`, `Cupon`, `Notificacion`, `SeguimientoStock`, `Orden`, `LineaPedido`, `Pago`, `ReciboTransaccion`, `Suscripcion`, with their associations (`hasMany` / `belongsTo`). Use Spanish names consistently in all later steps too (repositories, use cases, routes).
- `index.js`: Express + `cors` + `express.json()`, database connection with retries (MySQL takes a while to start inside Docker), `sequelize.sync()` for development, and a `GET /health` endpoint.
- The database itself is created by the MySQL container (`MYSQL_DATABASE`); Sequelize only creates the tables.
- Done when: `docker compose up --build backend mysql` starts without errors and `/health` returns 200.

### Step 2 — EventBus (Observer)
`domain/events/EventBus.js` using Node's `EventEmitter`. Events: `OrderCreated`, `OrderPaid`, `OrderCancelled`, `CartAbandoned`, `StockReplenished`, `SubscriptionUpgraded`, `SubscriptionExpiring`. Listeners in `infrastructure/notifications/`: `InventoryListener` (reserve/release stock), `NotificationListener` (create a `Notificacion`), `AnalyticsListener` (simple logging). They subscribe in `index.js`. Unit tests for the bus and for each listener.

### Step 3 — Repositories and use cases
Repositories that convert between Sequelize models and domain entities. Use cases in `use-cases/`: `RegistrarUsuario` (uses `Usuario.crear`, requires data-processing consent), `ConvertirEnVendedor`, `PublicarProducto` (limit of 5 products on the free plan), `AgregarAlCarrito`, `AbandonarCarrito`, `CrearOrden`, `ConfirmarPago`, `GenerarCuponPorInactividad`, `ActivarPremium`. Each one orchestrates entity + repository and emits its event to the `EventBus`. Tests use fake repositories (no database).

### Step 4 — Authentication and authorization
`POST /api/auth/register` and `POST /api/auth/login` (JWT with `JWT_SECRET` and `JWT_EXPIRES_IN`). An `auth` middleware and guards by role (`vendedor`) and plan (`premium`).

### Step 5 — Controllers and REST routes
Thin controllers that only call use cases. Resources: `auth`, `usuarios`, `categorias`, `productos`, `inventario`, `carrito`, `cupones`, `ordenes`, `pagos`, `notificaciones`, `seguimiento-stock`. Correct HTTP verbs and status codes (201, 400, 401, 403, 404, 409). A single, consistent response format (e.g. `{ success, data, message }`). Validate input at the boundary.

### Step 6 — OpenAPI / Swagger documentation
`docs/openapi.yaml` (OpenAPI 3) covering every endpoint, schemas, Bearer authentication, and examples. Serve it at `GET /api-docs` with `swagger-ui-express`.

### Step 7 — Payment gateway (Mercado Pago, sandbox)
- Dependency: `mercadopago` (the current SDK requires Node 18+; the project already uses Node 22). Verify it can be imported from CommonJS; if not, use dynamic `import()`.
- `infrastructure/payments/MercadoPagoGateway.js`: creates the payment preference/order from an existing `Orden`. The amount comes from `Orden.calcularTotal()`.
- `POST /api/pagos/webhook`: verifies the notification by querying the payment from Mercado Pago's API, and only then calls `ConfirmarPago` (which emits `OrderPaid`).
- Variable: `MP_ACCESS_TOKEN` (test credential). Add it to `compose.yml` as `${MP_ACCESS_TOKEN}` and to `.env.example`.
- Sandbox credentials only. No real money.

### Step 8 — Seeders, tests, and README
Seeders with sample data (categories, free and premium users, products with stock). Integration tests for the main endpoints using `supertest`. Update `README.md` with: how to run with Docker, environment variables, how to run tests, the Swagger URL, and how to try a payment in sandbox.

## Final deliverable

- `docker compose up --build` starts `mysql` and `backend`; `/health` and `/api-docs` respond.
- `npm run test:ci` passes.
- The full flow is demonstrable in sandbox: register → publish product → add to cart → create order → pay with a Mercado Pago test account → webhook → order paid → receipt generated.
