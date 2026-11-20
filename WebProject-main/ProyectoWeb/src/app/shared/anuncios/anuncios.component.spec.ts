import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';

import { AnunciosComponent } from './anuncios.component';
import { AnuncioService } from '../../services/anuncio.service';
import { Anuncio } from '../../models/anuncio.model';

describe('AnunciosComponent', () => {
  let component: AnunciosComponent;
  let fixture: ComponentFixture<AnunciosComponent>;
  let servicio: jasmine.SpyObj<AnuncioService>;

  async function create(anuncios: Anuncio[]) {
    servicio = jasmine.createSpyObj('AnuncioService', ['listarActivos']);
    servicio.listarActivos.and.returnValue(of(anuncios));
    await TestBed.configureTestingModule({
      imports: [AnunciosComponent, RouterTestingModule],
      providers: [{ provide: AnuncioService, useValue: servicio }],
    }).compileComponents();
    fixture = TestBed.createComponent(AnunciosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('renders real advertisements with label, price and product link', async () => {
    await create([{
      id: 1, titulo: 'Laptop en oferta', mensaje: 'Solo hoy', productoId: 9, precio: 9999, imagenUrl: 'x.jpg',
    }]);
    const items = fixture.debugElement.queryAll(By.css('.anuncio'));
    expect(items.length).toBe(1);
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Anuncio');
    expect(texto).toContain('Laptop en oferta');
    expect(texto).toContain('9,999');
    const enlace = fixture.debugElement.query(By.css('.anuncio a'));
    expect(enlace.attributes['href']).toBe('/productos/9');
  });

  it('renders nothing on empty responses', async () => {
    await create([]);
    expect(component.anuncios).toEqual([]);
    expect(fixture.debugElement.query(By.css('.anuncios'))).toBeNull();
  });
});
