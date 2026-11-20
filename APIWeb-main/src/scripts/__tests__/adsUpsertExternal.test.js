const fs = require('fs');
const os = require('os');
const path = require('path');

// Same require-time env-loader isolation as dbMigrate.test.js: import from
// an empty cwd so real .env* files never leak into this worker.
const _importCwd = process.cwd();
const _importTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'external-import-'));
process.chdir(_importTmp);
const { main, EXTERNAL_AD, resolveActive } = require('../adsUpsertExternal');
const sequelize = require('../../config/database');
const models = require('../../infrastructure/models');
const { validateAnuncioInput } = require('../../domain/anuncios/anuncioValidation');
process.chdir(_importCwd);
fs.rmSync(_importTmp, { recursive: true, force: true });

const IMAGE = 'https://example.com/autorizada.png';
const baseEnv = () => ({ ADS_EXTERNAL_IMAGE_URL: IMAGE });

describe('resolveActive', () => {
  it('defaults to active and parses explicit booleans', () => {
    expect(resolveActive({})).toBe(true);
    expect(resolveActive({ ADS_ACTIVE: '' })).toBe(true);
    expect(resolveActive({ ADS_ACTIVE: 'true' })).toBe(true);
    expect(resolveActive({ ADS_ACTIVE: '1' })).toBe(true);
    expect(resolveActive({ ADS_ACTIVE: 'false' })).toBe(false);
    expect(resolveActive({ ADS_ACTIVE: '0' })).toBe(false);
  });

  it('rejects anything else', () => {
    expect(() => resolveActive({ ADS_ACTIVE: 'maybe' })).toThrow(/ADS_ACTIVE/);
  });
});

describe('EXTERNAL_AD content', () => {
  it('matches the specified copy exactly', () => {
    expect(EXTERNAL_AD.title).toBe('Encuentra más productos en Mercado Libre');
    expect(EXTERNAL_AD.description)
      .toBe('Descubre miles de productos, ofertas y opciones de compra en Mercado Libre.');
    expect(EXTERNAL_AD.targetUrl).toBe('https://www.mercadolibre.com.mx/');
    expect(EXTERNAL_AD.advertiser).toBe('Mercado Libre');
    expect(EXTERNAL_AD.placement).toBe('catalogo');
  });

  it('claims no sponsorship, endorsement, or alliance', () => {
    const copy = `${EXTERNAL_AD.title} ${EXTERNAL_AD.description} ${EXTERNAL_AD.advertiser}`.toLowerCase();
    for (const word of ['patrocin', 'alianza', 'oficial', 'recomienda', 'avala', 'sponsor']) {
      expect(copy).not.toContain(word);
    }
  });

  it('passes shared validation with an authorized https image (production rules)', () => {
    const { errors, value } = validateAnuncioInput(
      { ...EXTERNAL_AD, imageUrl: IMAGE }, {}, { NODE_ENV: 'production' },
    );
    expect(errors).toBeUndefined();
    expect(value).toMatchObject({ placement: 'catalogo', active: true });
  });
});

describe('ads:upsert-external main()', () => {
  let authenticate;
  let findOne;

  beforeEach(() => {
    authenticate = jest.spyOn(sequelize, 'authenticate').mockResolvedValue(undefined);
    findOne = jest.spyOn(models.Anuncio, 'findOne');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refuses to run without an authorized image resource', async () => {
    await expect(main({})).rejects.toThrow(/ADS_EXTERNAL_IMAGE_URL/);
    expect(authenticate).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('rejects a non-https image without touching the database', async () => {
    const create = jest.spyOn(models.Anuncio, 'create');
    await expect(main({ ADS_EXTERNAL_IMAGE_URL: 'http://example.com/x.png' }))
      .rejects.toThrow(/HTTPS/);
    expect(authenticate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates the row when it does not exist', async () => {
    findOne.mockResolvedValue(null);
    const create = jest.spyOn(models.Anuncio, 'create')
      .mockImplementation(async (data) => ({ id: 2, ...data }));
    await main(baseEnv());

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith({
      where: { title: EXTERNAL_AD.title, advertiser: EXTERNAL_AD.advertiser },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      title: EXTERNAL_AD.title,
      targetUrl: 'https://www.mercadolibre.com.mx/',
      advertiser: 'Mercado Libre',
      placement: 'catalogo',
      active: true,
      imageUrl: IMAGE,
    });
  });

  it('updates only the matched row when it already exists', async () => {
    const update = jest.fn();
    findOne.mockResolvedValue({ id: 2, update });
    const create = jest.spyOn(models.Anuncio, 'create');
    await main(baseEnv());

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ active: true });
  });

  it('honors ADS_ACTIVE=false and ADS_END_AT verification overrides', async () => {
    findOne.mockResolvedValue(null);
    const create = jest.spyOn(models.Anuncio, 'create')
      .mockImplementation(async (data) => ({ id: 2, ...data }));
    await main({ ...baseEnv(), ADS_ACTIVE: 'false', ADS_END_AT: '2020-01-01T00:00:00.000Z' });

    expect(create.mock.calls[0][0]).toMatchObject({ active: false });
    expect(create.mock.calls[0][0].endAt).toEqual(new Date('2020-01-01T00:00:00.000Z'));
  });
});
