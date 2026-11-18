const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnvFile } = require('../dbSmoke');

describe('loadEnvFile (db:smoke ENV_FILE selection)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.ENV_FILE;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('keeps default .env behavior when ENV_FILE is unset', () => {
    expect(loadEnvFile({})).toBeNull();
  });

  it('keeps default .env behavior when ENV_FILE is blank', () => {
    expect(loadEnvFile({ ENV_FILE: '   ' })).toBeNull();
  });

  it('fails clearly when the requested file does not exist', () => {
    expect(() => loadEnvFile({ ENV_FILE: '.env.does-not-exist' }))
      .toThrow(/ENV_FILE no existe: \.env\.does-not-exist/);
  });

  it('loads variables from the requested file without touching other files', () => {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'envfile-')), '.env.case');
    fs.writeFileSync(tmp, 'ENVFILE_SMOKE_MARKER=from-requested-file\n');
    try {
      expect(loadEnvFile({ ENV_FILE: tmp })).toBe(tmp);
      expect(process.env.ENVFILE_SMOKE_MARKER).toBe('from-requested-file');
    } finally {
      delete process.env.ENVFILE_SMOKE_MARKER;
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  });

  it('supports double-quoted passwords with special characters', () => {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'envfile-')), '.env.quoted');
    fs.writeFileSync(tmp, 'ENVFILE_SMOKE_QUOTED="p@ss:w0rd!#%&"\n');
    try {
      loadEnvFile({ ENV_FILE: tmp });
      expect(process.env.ENVFILE_SMOKE_QUOTED).toBe('p@ss:w0rd!#%&');
    } finally {
      delete process.env.ENVFILE_SMOKE_QUOTED;
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  });

  it('never overrides variables already present in the environment', () => {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'envfile-')), '.env.nooverride');
    fs.writeFileSync(tmp, 'ENVFILE_SMOKE_PINNED=from-file\n');
    process.env.ENVFILE_SMOKE_PINNED = 'from-environment';
    try {
      loadEnvFile({ ENV_FILE: tmp });
      expect(process.env.ENVFILE_SMOKE_PINNED).toBe('from-environment');
    } finally {
      delete process.env.ENVFILE_SMOKE_PINNED;
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  });
});
