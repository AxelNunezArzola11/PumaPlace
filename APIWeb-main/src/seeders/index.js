require('dotenv').config();
const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');
const { Usuario, Categoria, Producto, Inventario } = require('../infrastructure/models');

async function seed() {
  await sequelize.authenticate();
  await sequelize.sync();

  const passwordHash = await bcrypt.hash('PumaPlace123!', 10);
  const [freeUser] = await Usuario.findOrCreate({
    where: { correo: 'vendedor.free@unam.mx' },
    defaults: {
      passwordHash,
      edad: 20,
      rol: 'vendedor',
      plan: 'free',
      consentimientoDatos: true,
    },
  });
  const [premiumUser] = await Usuario.findOrCreate({
    where: { correo: 'vendedor.premium@unam.mx' },
    defaults: {
      passwordHash,
      edad: 22,
      rol: 'vendedor',
      plan: 'premium',
      consentimientoDatos: true,
    },
  });
  const [categoria] = await Categoria.findOrCreate({
    where: { nombre: 'Libros' },
    defaults: { descripcion: 'Libros y material académico' },
  });
  const [producto] = await Producto.findOrCreate({
    where: { nombre: 'Libro de muestra', vendedorId: freeUser.id },
    defaults: {
      categoriaId: categoria.id,
      descripcion: 'Producto de ejemplo para probar el flujo de compra.',
      precio: 150,
      estado: 'publicado',
    },
  });
  await Inventario.findOrCreate({
    where: { productoId: producto.id },
    defaults: { cantidadDisponible: 10, cantidadReservada: 0 },
  });
  console.log(`Seed completado. Usuarios: ${freeUser.correo}, ${premiumUser.correo}`);
}

seed()
  .catch((error) => {
    console.error('No se pudo ejecutar el seed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
