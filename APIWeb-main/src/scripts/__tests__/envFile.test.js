const fs = require('fs');
const os = require('os');
const path = require('path');

// The module runs its env loader at require time: import it from an empty
// cwd so the developer's real .env* files are never loaded into this worker.
const _importCwd = process.cwd();
const _importTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envfile-import-'));
process.chdir(_importTmp);
const { loadEnvFile } = require('../dbSmoke');
process.chdir(_importCwd);
fs.rmSync(_importTmp, { recursive: true, force: true });

describe('loadEnvFile (db:smoke ENV_FILE selection)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.ENV_FILE;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  // Default-selection tests must not depend on (or load) whatever .env*
  // files the developer happens to have: they run in an empty temp cwd.
  function inTmpDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envfallback-'));
    const previous = process.cwd();
    process.chdir(dir);
    try {
      return fn(dir);
    } finally {
      process.chdir(previous);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('keeps default .env behavior when ENV_FILE is unset', () => {
    inTmpDir(() => {
      expect(loadEnvFile({})).toBeNull();
    });
  });

  it('keeps default .env behavior when ENV_FILE is blank', () => {
    inTmpDir(() => {
      expect(loadEnvFile({ ENV_FILE: '   ' })).toBeNull();
    });
  });

  it('falls back to ./.env.tidb when ENV_FILE is unset and ./.env is absent', () => {
    inTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, '.env.tidb'), 'ENVFILE_FALLBACK_MARKER=from-tidb-fallback\n');
      try {
        expect(loadEnvFile({})).toBe('.env.tidb');
        expect(process.env.ENVFILE_FALLBACK_MARKER).toBe('from-tidb-fallback');
      } finally {
        delete process.env.ENVFILE_FALLBACK_MARKER;
      }
    });
  });

  it('prefers ./.env over the ./.env.tidb fallback when both exist', () => {
    inTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, '.env'), 'ENVFILE_DOTENV_MARKER=from-dotenv\n');
      fs.writeFileSync(path.join(dir, '.env.tidb'), 'ENVFILE_FALLBACK_SKIPPED=from-tidb-fallback\n');
      try {
        expect(loadEnvFile({})).toBeNull();
        expect(process.env.ENVFILE_DOTENV_MARKER).toBe('from-dotenv');
        expect(process.env.ENVFILE_FALLBACK_SKIPPED).toBeUndefined();
      } finally {
        delete process.env.ENVFILE_DOTENV_MARKER;
        delete process.env.ENVFILE_FALLBACK_SKIPPED;
      }
    });
  });

  it('prefers an explicit ENV_FILE over local .env files', () => {
    inTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, '.env'), 'ENVFILE_DOTENV_SKIPPED=from-dotenv\n');
      fs.writeFileSync(path.join(dir, '.env.tidb'), 'ENVFILE_FALLBACK_SKIPPED=from-tidb-fallback\n');
      const tmp = path.join(dir, '.env.explicit');
      fs.writeFileSync(tmp, 'ENVFILE_EXPLICIT_MARKER=from-requested-file\n');
      try {
        expect(loadEnvFile({ ENV_FILE: tmp })).toBe(tmp);
        expect(process.env.ENVFILE_EXPLICIT_MARKER).toBe('from-requested-file');
        expect(process.env.ENVFILE_DOTENV_SKIPPED).toBeUndefined();
        expect(process.env.ENVFILE_FALLBACK_SKIPPED).toBeUndefined();
      } finally {
        delete process.env.ENVFILE_EXPLICIT_MARKER;
        delete process.env.ENVFILE_DOTENV_SKIPPED;
        delete process.env.ENVFILE_FALLBACK_SKIPPED;
      }
    });
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
