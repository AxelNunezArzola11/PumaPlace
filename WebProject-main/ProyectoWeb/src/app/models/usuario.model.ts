export interface Usuario {
  id: number;
  correo: string;
  edad?: number;
  rol: 'comprador' | 'vendedor' | 'dual';
  plan: 'free' | 'premium';
  token?: string;
  nombre?: string;
  name?: string;
  email?: string;
  role?: string;
}

export interface CredencialesLogin {
  correo: string;
  password: string;
}

export interface RegistroUsuario {
  correo: string;
  password: string;
  edad: number;
  consentimientoDatos: boolean;
}