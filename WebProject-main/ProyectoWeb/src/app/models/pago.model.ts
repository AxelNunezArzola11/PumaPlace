export type MetodoPago = 'efectivo' | 'transferencia' | 'mercado_pago';

export interface DatosTarjeta {
  numeroTarjeta: string;
  titular: string;
  fechaExpiracion: string;
  cvv: string;
}

export interface Pago {
  id?: number;
  ordenId: number;
  monto: number;
  fecha?: Date;
  metodoPago: MetodoPago;
  estado: 'pendiente' | 'aprobado' | 'fallido';
  referencia?: string;
  datosPago?: any; // Información específica según el método de pago
} 