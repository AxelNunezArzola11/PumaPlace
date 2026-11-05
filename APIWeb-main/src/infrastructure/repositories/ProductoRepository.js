const Producto = require('../models/Producto');
const Inventario = require('../models/Inventario');

const plain = (record) => (record && typeof record.toJSON === 'function' ? record.toJSON() : record);

class ProductoRepository {
  constructor({ model = Producto, inventarioModel = Inventario } = {}) {
    this.model = model;
    this.inventarioModel = inventarioModel;
  }

  async countByVendedor(vendedorId) {
    return this.model.count({ where: { vendedorId } });
  }

  async findAll(options = {}) {
    const records = await this.model.findAll({
      ...options,
      include: [{ model: this.inventarioModel, as: 'inventario' }],
    });
    return records.map(plain);
  }

  async create(data) {
    return plain(await this.model.create(data));
  }

  async findById(id) {
    const record = await this.model.findByPk(id);
    if (!record) return null;
    const inventario = await this.inventarioModel.findOne({ where: { productoId: id } });
    const data = plain(record);
    return { ...data, inventario: plain(inventario) };
  }

  async updateById(id, data) {
    const { cantidadDisponible, ...productoData } = data;
    const record = await this.model.findByPk(id);
    if (!record) return null;
    await record.update(productoData);
    if (cantidadDisponible !== undefined) {
      const inventario = await this.inventarioModel.findOne({ where: { productoId: id } });
      if (inventario) await inventario.update({ cantidadDisponible });
    }
    return this.findById(id);
  }
}

module.exports = ProductoRepository;
