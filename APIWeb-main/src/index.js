const express = require('express');
const cors = require('cors');
const sequelize = require('./config/database');
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
app.use(cors());
app.use(express.json());

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
  const status = error.name === 'SequelizeUniqueConstraintError'
    ? 409
    : /credenciales inválidas|token|autenticación/i.test(error.message) ? 401 : 400;
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
  await connectWithRetry();
  if (process.env.NODE_ENV !== 'production') {
    await sequelize.sync();
    await ensureProductImageColumn();
    await ensureDefaultCategories();
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
