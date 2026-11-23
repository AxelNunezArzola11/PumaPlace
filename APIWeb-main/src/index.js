const express = require('express');
const cors = require('cors');
const sequelize = require('./config/database');
const { assertEnv, getConfig } = require('./config/env');
const { buildCorsOptions } = require('./config/cors');
const { createLimiters } = require('./middlewares/rateLimit');
const models = require('./infrastructure/models');
const EventBus = require('./domain/events/EventBus');
const InventoryListener = require('./infrastructure/notifications/InventoryListener');
const NotificationListener = require('./infrastructure/notifications/NotificationListener');
const AnalyticsListener = require('./infrastructure/notifications/AnalyticsListener');
const UsuarioRepository = require('./infrastructure/repositories/UsuarioRepository');
const RegistrarUsuario = require('./use-cases/RegistrarUsuario');
const IniciarSesion = require('./use-cases/IniciarSesion');
const createAuthRoutes = require('./routes/auth');
const createApiRoutes = require('./routes/api');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
const openapiDocument = YAML.load(path.join(__dirname, '../docs/openapi.yaml'));

const app = express();
// Render puts exactly ONE reverse proxy in front of this service: trust
// that hop and only that hop, so req.ip is the real client IP. Never
// `true` — it would let anyone spoof X-Forwarded-For and evade limits.
app.set('trust proxy', 1);
// Restricted CORS: production allows ONLY FRONTEND_URL; development also
// allows the local Angular dev server. Requests without Origin (curl, the
// Mercado Pago webhook) always pass through.
app.use(cors(buildCorsOptions()));
app.use(express.json());

// Rate limits (memory store: correct for single-instance Render Free).
// Strict limiters first so sensitive endpoints trip before the general one.
// /health is outside every limiter mount; the webhook is skipped inside.
const { apiLimiter, loginLimiter, registerLimiter, preferenciaLimiter } = createLimiters(
  getConfig().rateLimit,
);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/pagos/preferencia', preferenciaLimiter);
app.use('/api', apiLimiter);

const usuarioRepository = new UsuarioRepository();
const registrarUsuario = new RegistrarUsuario({ usuarioRepository });
const iniciarSesion = new IniciarSesion({ usuarioRepository });
app.use('/api/auth', createAuthRoutes({ registrarUsuario, iniciarSesion }));

const eventBus = new EventBus();
app.use('/api', createApiRoutes({ eventBus }));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || (error.name === 'SequelizeUniqueConstraintError'
    ? 409
    : /credenciales inválidas|token|autenticación/i.test(error.message) ? 401 : 400);
  if (error.type === 'REGLA_DE_NEGOCIO') {
    return res.status(422).json({
      type: 'https://pumaplace.example/problems/regla-de-negocio',
      title: 'Regla de negocio incumplida',
      status: 422,
      detail: error.message,
      code: 'REGLA_DE_NEGOCIO',
    });
  }
  if (error.invalid_params) {
    return res.status(status).json({
      type: 'https://pumaplace.example/problems/validation',
      title: 'Datos inválidos',
      status,
      detail: error.message,
      invalid_params: error.invalid_params,
    });
  }
  return res.status(status).json({ success: false, message: error.message });
});

const listeners = [
  new InventoryListener({ eventBus }),
  new NotificationListener({ eventBus }),
  new AnalyticsListener({ eventBus }),
];

const MAX_DB_RETRIES = Number(process.env.DB_MAX_RETRIES || 10);
const DB_RETRY_DELAY_MS = Number(process.env.DB_RETRY_DELAY_MS || 5000);

const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

async function connectWithRetry() {
  for (let attempt = 1; attempt <= MAX_DB_RETRIES; attempt += 1) {
    try {
      await sequelize.authenticate();
      return;
    } catch (error) {
      if (attempt === MAX_DB_RETRIES) {
        throw error;
      }
      console.error(`Database connection attempt ${attempt} failed; retrying...`);
      await wait(DB_RETRY_DELAY_MS);
    }
  }
}

async function start() {
  // Fail fast on missing/invalid environment (names only, never values).
  // Runs here — not at require time — so tests can import { app } freely.
  assertEnv();
  await connectWithRetry();
  if (process.env.NODE_ENV !== 'production') {
    await sequelize.sync();
    await ensureProductImageColumn();
    await ensureSellerColumns();
    await ensureOrderProcessingDeadlineColumn();
    await ensurePagoOrdenIdUnique();
    await ensureDefaultCategories();
  }

  async function ensurePagoOrdenIdUnique() {
    // sync() never alters existing tables, so pre-existing dev databases
    // need the webhook idempotency backstop added explicitly. Fresh
    // databases (TiDB via db:migrate) get it from the model definition.
    const queryInterface = sequelize.getQueryInterface();
    const indexes = await queryInterface.showIndex('pagos');
    const hasUnique = indexes.some((index) => index.unique
      && (index.fields || []).some((field) => field.attribute === 'ordenId'));
    if (!hasUnique) {
      await queryInterface.addConstraint('pagos', {
        fields: ['ordenId'],
        type: 'unique',
        name: 'pagos_ordenId_unique',
      });
    }
  }

  async function ensureSellerColumns() {
    const queryInterface = sequelize.getQueryInterface();
    const table = await queryInterface.describeTable('usuarios');
    await queryInterface.changeColumn('usuarios', 'rol', {
      type: models.Usuario.rawAttributes.rol.type,
      allowNull: false,
      defaultValue: 'comprador',
    });
    if (table.numeroCuenta) {
      await queryInterface.changeColumn('usuarios', 'numeroCuenta', {
        type: models.Usuario.rawAttributes.numeroCuenta.type,
        allowNull: true,
      });
    }
    const columns = [
      ['nombreCompleto', models.Usuario.rawAttributes.nombreCompleto.type],
      ['telefono', models.Usuario.rawAttributes.telefono.type],
      ['numeroCuenta', models.Usuario.rawAttributes.numeroCuenta.type],
      ['datosPagoCifrados', models.Usuario.rawAttributes.datosPagoCifrados.type],
    ];
    for (const [name, type] of columns) {
      if (!table[name]) await queryInterface.addColumn('usuarios', name, { type, allowNull: true });
    }
  }

  async function ensureOrderProcessingDeadlineColumn() {
    const queryInterface = sequelize.getQueryInterface();
    const table = await queryInterface.describeTable('ordenes');
    const attribute = models.Orden.rawAttributes.fechaLimiteProcesamiento;
    if (!table.fechaLimiteProcesamiento) {
      await queryInterface.addColumn('ordenes', 'fechaLimiteProcesamiento', {
        type: attribute.type,
        allowNull: true,
      });
    } else {
      await queryInterface.changeColumn('ordenes', 'fechaLimiteProcesamiento', {
        type: attribute.type,
        allowNull: true,
      });
    }
  }
  const port = Number(process.env.PORT || 3000);
  return app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

async function ensureProductImageColumn() {
  const table = await sequelize.getQueryInterface().describeTable('productos');
  if (!table.imagenUrl) {
    await sequelize.getQueryInterface().addColumn('productos', 'imagenUrl', {
      type: models.Producto.rawAttributes.imagenUrl.type,
      allowNull: true,
    });
  }
}

async function ensureDefaultCategories() {
  const categories = [
    ['Electrónica', 'Dispositivos y accesorios electrónicos'],
    ['Ropa', 'Ropa y accesorios'],
    ['Hogar', 'Artículos para el hogar'],
    ['Herramientas', 'Herramientas y equipo'],
    ['Libros', 'Libros y material académico'],
    ['Juguetes', 'Juguetes y entretenimiento'],
    ['Mascotas', 'Artículos para mascotas'],
    ['Belleza y salud', 'Productos de belleza y salud'],
  ];
  for (const [nombre, descripcion] of categories) {
    await models.Categoria.findOrCreate({ where: { nombre }, defaults: { descripcion } });
  }
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Unable to start server:', error);
    process.exitCode = 1;
  });
}

module.exports = { app, connectWithRetry, start, eventBus, listeners };
