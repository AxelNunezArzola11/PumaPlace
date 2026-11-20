import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AnuncioService } from './anuncio.service';
import { ApiService } from './api.service';
import { environment } from '../../environments/environment';

describe('AnuncioService', () => {
  let service: AnuncioService;
  let api: jasmine.SpyObj<ApiService>;
  const originalFlag = environment.advertisementsEnabled;

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
    const data = [{ id: 1, titulo: 'Oferta', productoId: 9, activo: true }];
    api.get.and.returnValue(of(data));
    service.listarActivos().subscribe(anuncios => {
      expect(api.get).toHaveBeenCalledWith('anuncios/activos');
      expect(anuncios).toEqual(data);
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

  it('filters out invalid or inactive advertisements', (done) => {
    environment.advertisementsEnabled = true;
    api.get.and.returnValue(of([
      { id: 1, titulo: 'Válido', productoId: 9 },
      { id: 2, titulo: '', productoId: 9 },
      { id: 3, titulo: 'Sin producto', productoId: null },
      { id: 4, titulo: 'Inactivo', productoId: 9, activo: false },
      null,
    ]));
    service.listarActivos().subscribe(anuncios => {
      expect(anuncios).toEqual([{ id: 1, titulo: 'Válido', productoId: 9 }]);
      done();
    });
  });
});
