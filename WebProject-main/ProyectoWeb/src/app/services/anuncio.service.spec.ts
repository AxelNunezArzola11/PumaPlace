import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AnuncioService, isSafeAdUrl, isValidAnuncio } from './anuncio.service';
import { ApiService } from './api.service';
import { environment } from '../../environments/environment';

describe('AnuncioService', () => {
  let service: AnuncioService;
  let api: jasmine.SpyObj<ApiService>;
  const originalFlag = environment.advertisementsEnabled;

  const validAd = {
    id: 1,
    title: 'Promo estudiantes',
    description: 'Descuento con credencial',
    imageUrl: 'https://example.com/img.png',
    targetUrl: 'https://example.com/oferta',
    advertiser: 'Tienda X',
    placement: 'catalogo',
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('ApiService', ['get']);
    TestBed.configureTestingModule({
      providers: [AnuncioService, { provide: ApiService, useValue: api }],
    });
    service = TestBed.inject(AnuncioService);
  });

  afterEach(() => {
    environment.advertisementsEnabled = originalFlag;
  });

  it('makes no HTTP request while the integration is disabled', (done) => {
    environment.advertisementsEnabled = false;
    service.listarActivos().subscribe(anuncios => {
      expect(anuncios).toEqual([]);
      expect(api.get).not.toHaveBeenCalled();
      done();
    });
  });

  it('returns real API data when enabled', (done) => {
    environment.advertisementsEnabled = true;
    api.get.and.returnValue(of([validAd]));
    service.listarActivos().subscribe(anuncios => {
      expect(api.get).toHaveBeenCalledWith('anuncios/activos');
      expect(anuncios).toEqual([validAd]);
      done();
    });
  });

  it('returns an empty list when the API fails', (done) => {
    environment.advertisementsEnabled = true;
    api.get.and.returnValue(throwError(() => ({ status: 500 })));
    service.listarActivos().subscribe(anuncios => {
      expect(anuncios).toEqual([]);
      done();
    });
  });

  it('filters out invalid or unsafe advertisements', (done) => {
    environment.advertisementsEnabled = true;
    api.get.and.returnValue(of([
      validAd,
      { ...validAd, id: 2, title: '' },
      { ...validAd, id: 3, advertiser: '  ' },
      { ...validAd, id: 4, imageUrl: 'http://example.com/x.png' },
      { ...validAd, id: 5, targetUrl: 'javascript:alert(1)' },
      { ...validAd, id: 6, targetUrl: 'https://user:pass@example.com/' },
      { ...validAd, id: 0 },
      null,
    ]));
    service.listarActivos().subscribe(anuncios => {
      expect(anuncios).toEqual([validAd]);
      done();
    });
  });

  it('ignores non-array payloads', (done) => {
    environment.advertisementsEnabled = true;
    api.get.and.returnValue(of({ data: [validAd] } as unknown as []));
    service.listarActivos().subscribe(anuncios => {
      expect(anuncios).toEqual([]);
      done();
    });
  });
});

describe('isSafeAdUrl', () => {
  it('accepts HTTPS everywhere', () => {
    expect(isSafeAdUrl('https://example.com/x.png', false)).toBeTrue();
    expect(isSafeAdUrl('https://example.com/x.png', true)).toBeTrue();
  });

  it('rejects non-HTTPS, non-URLs, and credentialed URLs', () => {
    for (const allowLocalhost of [false, true]) {
      expect(isSafeAdUrl('http://example.com/x.png', allowLocalhost)).toBeFalse();
      expect(isSafeAdUrl('not-a-url', allowLocalhost)).toBeFalse();
      expect(isSafeAdUrl('javascript:alert(1)', allowLocalhost)).toBeFalse();
      expect(isSafeAdUrl('https://user:pass@example.com/', allowLocalhost)).toBeFalse();
      expect(isSafeAdUrl('', allowLocalhost)).toBeFalse();
      expect(isSafeAdUrl(null, allowLocalhost)).toBeFalse();
    }
  });

  it('accepts localhost http only in local development', () => {
    expect(isSafeAdUrl('http://localhost:3000/x.png', true)).toBeTrue();
    expect(isSafeAdUrl('http://localhost:3000/x.png', false)).toBeFalse();
  });
});

describe('isValidAnuncio', () => {
  const base = {
    id: 1,
    title: 'T',
    imageUrl: 'https://example.com/i.png',
    targetUrl: 'https://example.com/t',
    advertiser: 'A',
  };

  it('accepts complete safe records', () => {
    expect(isValidAnuncio(base, false)).toBeTrue();
    expect(isValidAnuncio({ ...base, description: null, placement: 'banner' }, false)).toBeTrue();
  });

  it('rejects incomplete or unsafe records', () => {
    expect(isValidAnuncio({ ...base, id: 0 }, false)).toBeFalse();
    expect(isValidAnuncio({ ...base, title: ' ' }, false)).toBeFalse();
    expect(isValidAnuncio({ ...base, advertiser: '' }, false)).toBeFalse();
    expect(isValidAnuncio({ ...base, imageUrl: 'http://example.com/i.png' }, false)).toBeFalse();
    expect(isValidAnuncio(null, false)).toBeFalse();
    expect(isValidAnuncio('ad', false)).toBeFalse();
  });
});
