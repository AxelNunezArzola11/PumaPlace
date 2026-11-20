const fs = require('fs');
const os = require('os');
const path = require('path');

// The module runs its env loader at require time: import it from an empty
// cwd so the developer's real .env* files are never loaded into this worker.
const _importCwd = process.cwd();
const _importTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-import-'));
process.chdir(_importTmp);
const { main, assertRemoteTarget, DEFAULT_CATEGORIES } = require('../dbMigrate');
const sequelize = require('../../config/database');
process.chdir(_importCwd);
fs.rmSync(_importTmp, { recursive: true, force: true });

describe('assertRemoteTarget (db:migrate guard)', () => {
  it.each([['localhost'], ['127.0.0.1'], ['::1'], ['mysql'], ['LOCALHOST']])(
    'refuses the local target %s without an explicit override',
    (host) => {
      expect(() => assertRemoteTarget({ DB_HOST: host })).toThrow(/LOCAL/);
    },
  );

  it('allows a local target only with ALLOW_LOCAL_MIGRATE=true', () => {
    expect(assertRemoteTarget({ DB_HOST: 'localhost', ALLOW_LOCAL_MIGRATE: 'true' }))
      .toBe('localhost');
    expect(() => assertRemoteTarget({ DB_HOST: 'localhost', ALLOW_LOCAL_MIGRATE: 'false' }))
      .toThrow(/LOCAL/);
  });

  it('allows TiDB Cloud hosts verbatim (prefix included)', () => {
    expect(assertRemoteTarget({ DB_HOST: 'cluster1.tidbcloud.com' }))
      .toBe('cluster1.tidbcloud.com');
  });

  it('fails clearly when DB_HOST is missing', () => {
    expect(() => assertRemoteTarget({})).toThrow(/DB_HOST/);
    expect(() => assertRemoteTarget({ DB_HOST: '   ' })).toThrow(/DB_HOST/);
  });
});

describe('db:migrate idempotency contract', () => {
  it('seeds exactly the 8 documented default categories', () => {
    expect(DEFAULT_CATEGORIES.map(([nombre]) => nombre)).toEqual([
      'Electrónica',
      'Ropa',
      'Hogar',
      'Herramientas',
      'Libros',
      'Juguetes',
      'Mascotas',
      'Belleza y salud',
    ]);
  });
});

describe('db:migrate ENV_FILE selection', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.ENV_FILE;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('loads the explicitly selected file at startup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-env-'));
    const tmp = path.join(dir, '.env.tidb.case');
    fs.writeFileSync(tmp, 'MIGRATE_ENVFILE_MARKER=from-requested-file\n');
    process.env.ENV_FILE = tmp;
    try {
      jest.isolateModules(() => {
        require('../dbMigrate');
      });
      expect(process.env.MIGRATE_ENVFILE_MARKER).toBe('from-requested-file');
    } finally {
      delete process.env.MIGRATE_ENVFILE_MARKER;
      delete process.env.ENV_FILE;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails clearly when the selected file does not exist', () => {
    process.env.ENV_FILE = '.env.does-not-exist';
    expect(() => jest.isolateModules(() => {
      require('../dbMigrate');
    })).toThrow(/ENV_FILE no existe: \.env\.does-not-exist/);
  });

  it('keeps default .env behavior when ENV_FILE is unset', () => {
    // Empty temp cwd: the require-time loader must not see (or load) the
    // developer's real .env* files.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-env-default-'));
    const previous = process.cwd();
    process.chdir(dir);
    try {
      expect(() => jest.isolateModules(() => {
        require('../dbMigrate');
      })).not.toThrow();
    } finally {
      process.chdir(previous);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('remote-target guard runs before any connection', () => {
  it('refuses localhost without opening a connection', async () => {
    const authenticate = jest.spyOn(sequelize, 'authenticate').mockResolvedValue(undefined);
    try {
      await expect(main({ DB_HOST: 'localhost', DB_NAME: 'mydb' })).rejects.toThrow(/LOCAL/);
      expect(authenticate).not.toHaveBeenCalled();
    } finally {
      authenticate.mockRestore();
    }
  });

  it('refuses a blank DB_HOST without opening a connection', async () => {
    const authenticate = jest.spyOn(sequelize, 'authenticate').mockResolvedValue(undefined);
    try {
      await expect(main({})).rejects.toThrow(/DB_HOST/);
      expect(authenticate).not.toHaveBeenCalled();
    } finally {
      authenticate.mockRestore();
    }
  });
});
