import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UsuariosModalComponent } from './usuarios-modal.component';

describe('UsuariosModalComponent', () => {
  let component: UsuariosModalComponent;
  let fixture: ComponentFixture<UsuariosModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UsuariosModalComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UsuariosModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
