import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';

import { AnunciosComponent, isExternalUrl } from './anuncios.component';
import { AnuncioService } from '../../services/anuncio.service';
import { Anuncio } from '../../models/anuncio.model';

describe('AnunciosComponent', () => {
  let component: AnunciosComponent;
  let fixture: ComponentFixture<AnunciosComponent>;
  let servicio: jasmine.SpyObj<AnuncioService>;

  const ad: Anuncio = {
    id: 1,
    title: 'Promo estudiantes',
    description: 'Descuento con credencial',
    imageUrl: 'https://example.com/img.png',
    targetUrl: 'https://example.com/oferta',
    advertiser: 'Tienda X',
    placement: 'catalogo',
  };

  // Karma serves tests from localhost, so a localhost target counts as internal.
  const internalAd: Anuncio = {
    id: 2,
    title: 'Anuncio interno',
    description: 'De la propia tienda',
    imageUrl: 'https://example.com/interna.png',
    targetUrl: 'http://localhost:4200/',
    advertiser: 'PumaPlace (anuncio interno)',
    placement: 'catalogo',
  };

  async function createWith(list: Anuncio[]) {
    servicio = jasmine.createSpyObj('AnuncioService', ['listarActivos']);
    servicio.listarActivos.and.returnValue(of(list));
    await TestBed.configureTestingModule({
      imports: [AnunciosComponent],
      providers: [{ provide: AnuncioService, useValue: servicio }],
    }).compileComponents();
    fixture = TestBed.createComponent(AnunciosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('renders real advertisements with label, details, and external link', async () => {
    await createWith([ad]);
    const items = fixture.debugElement.queryAll(By.css('.anuncio'));
    expect(items.length).toBe(1);
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Publicidad');
    expect(texto).toContain('Anuncio');
    expect(texto).toContain('Promo estudiantes');
    expect(texto).toContain('Descuento con credencial');
    expect(texto).toContain('Anunciante: Tienda X');
    const enlace = fixture.debugElement.query(By.css('.anuncio a'));
    expect(enlace.attributes['href']).toBe('https://example.com/oferta');
    expect(enlace.attributes['target']).toBe('_blank');
    expect(enlace.attributes['rel']).toContain('noopener');
    const imagen = fixture.debugElement.query(By.css('.anuncio img'));
    expect(imagen.attributes['src']).toBe('https://example.com/img.png');
  });

  it('marks off-site destinations with a visible ENLACE EXTERNO badge', async () => {
    await createWith([ad]);
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('ENLACE EXTERNO');
    const insignia = fixture.debugElement.query(By.css('.etiqueta-externa'));
    expect(insignia).not.toBeNull();
    const enlace = fixture.debugElement.query(By.css('.anuncio a'));
    expect(enlace.attributes['rel']).toBe('noopener noreferrer');
  });

  it('keeps same-site ads without the external badge', async () => {
    await createWith([internalAd]);
    expect(fixture.debugElement.query(By.css('.etiqueta-externa'))).toBeNull();
    const enlace = fixture.debugElement.query(By.css('.anuncio a'));
    expect(enlace.attributes['rel']).toBe('noopener');
    // The ANUNCIO badge still applies to every ad.
    expect(fixture.debugElement.query(By.css('.etiqueta'))).not.toBeNull();
  });

  it('renders nothing on empty responses (never fake ads)', async () => {
    await createWith([]);
    expect(component.anuncios).toEqual([]);
    expect(component.cargando).toBeFalse();
    expect(fixture.debugElement.query(By.css('.anuncios'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.anuncios-error'))).toBeNull();
  });

  it('shows an inline error without breaking the page when the API fails', async () => {
    servicio = jasmine.createSpyObj('AnuncioService', ['listarActivos']);
    servicio.listarActivos.and.returnValue(throwError(() => new Error('down')));
    await TestBed.configureTestingModule({
      imports: [AnunciosComponent],
      providers: [{ provide: AnuncioService, useValue: servicio }],
    }).compileComponents();
    fixture = TestBed.createComponent(AnunciosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.error).toBeTrue();
    expect(fixture.debugElement.query(By.css('.anuncios'))).toBeNull();
    const aviso = fixture.debugElement.query(By.css('.anuncios-error'));
    expect(aviso).not.toBeNull();
    expect((aviso.nativeElement.textContent as string)).toContain('No se pudieron cargar los anuncios');
  });
});

describe('isExternalUrl', () => {
  it('detects off-site hosts case-insensitively', () => {
    expect(isExternalUrl('https://www.mercadolibre.com.mx/', 'puma-place-web.onrender.com')).toBeTrue();
    expect(isExternalUrl('https://PUMA-PLACE-WEB.onrender.com/x', 'puma-place-web.onrender.com')).toBeFalse();
  });

  it('treats the same host (any scheme or port) as internal', () => {
    expect(isExternalUrl('https://example.com/a', 'example.com')).toBeFalse();
    expect(isExternalUrl('http://localhost:4200/', 'localhost')).toBeFalse();
  });

  it('fails closed on invalid input', () => {
    expect(isExternalUrl('not-a-url', 'example.com')).toBeFalse();
    expect(isExternalUrl('', 'example.com')).toBeFalse();
    expect(isExternalUrl(null, 'example.com')).toBeFalse();
    expect(isExternalUrl(undefined, 'example.com')).toBeFalse();
  });
});
