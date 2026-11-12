# Puma Place — Tecnologías

# ADR 001: Selección del Stack Tecnológico y Patrón de Arquitectura

* **Estado**: 
* **Fecha**: 2026-09-22
* **Squad**: AKAS
* **Autores**: Axel (PM), Andros(Desarrollador), Kevin(Desarrollador) y Sebastian(Desarrollador)

## 1. Contexto y Problema

Tras las entrevistas de validación de mercado, identificamos que **Puma Place** necesita resolver la compra-venta desorganizada de artículos usados entre estudiantes de la UNAM (a partir de Ciudad Universitaria). Hoy este intercambio ocurre en grupos dispersos de Facebook, WhatsApp y Telegram, donde publicar un producto toma entre 15 y 37 minutos, los vendedores pierden el control de su inventario, hay cancelaciones de última hora y las entregas carecen de puntos seguros, lo que genera miedo a asaltos, estafas y pagos con billetes falsos.

Requerimos una arquitectura web que nos permita desarrollar ágilmente, garantizar el desacoplamiento entre la lógica de negocio y la infraestructura, y facilitar la integración con servicios externos (pasarela de pago Mercado Pago, verificación de correo @unam.mx).

## 2. Decisión

Hemos decidido adoptar las siguientes tecnologías y patrones para el desarrollo del proyecto:

* **Lenguaje y Framework Backend**: Node.js con Express, usando Sequelize como ORM
* **Framework Frontend**: Angular (TypeScript)
* **Base de Datos Principal**: MySQL 8.0
* **Patrón de Arquitectura / Diseño**: Observer, para desacoplar la actualización de inventario y notificaciones (ej. cambios en productos, órdenes) de los componentes que reaccionan a ellas
* **Contenerización**: Docker (backend, frontend y base de datos orquestados con Docker Compose)
* **Hosting**: Vercel

## 3. Alternativas Consideradas

* **Opción A (Descartada)**: [Ej. Django Monolítico] — *Motivo de descarte*: [Ej. Dificulta la separación estricta entre frontend y backend que requiere el equipo].
* **Opción B (Descartada)**: [Ej. PostgreSQL] — *Motivo de descarte*: [Ej. El equipo ya tenía experiencia previa con MySQL y no se requerían tipos de datos JSON nativos avanzados].

## 4. Consecuencias

* **Positivas**:
  * Separación clara de responsabilidades entre capas (frontend Angular / backend Express / base de datos MySQL).
  * El patrón Observer permite que módulos como inventario, notificaciones y órdenes reaccionen a cambios sin acoplarse directamente entre sí.
  * Curva de aprendizaje alineada con la experiencia previa del squad.
  * Despliegue reproducible gracias a Docker, y hosting simplificado con Vercel.

* **Riesgos / Limitaciones**:
  * Mayor tiempo inicial invertido en la configuración de la estructura (*scaffolding*) y de los contenedores Docker.
  * Necesidad de mantener disciplinadamente las reglas de importación entre capas.
  * Vercel está optimizado para frontend/serverless; el backend con Express + MySQL puede requerir ajustes o un servicio de hosting adicional para la base de datos.

## Backend

Desde [APIWeb-main/](./APIWeb-main/) instala dependencias y ejecuta las pruebas:

```bash
npm ci
npm run test:ci
```

Para iniciar la base de datos y la API:

```bash
docker compose up --build mysql backend
```

La API queda disponible en `http://localhost:3000`, el estado en `/health` y Swagger UI en `/api-docs`.
Configura las variables de [APIWeb-main/.env.example](./APIWeb-main/.env.example), incluyendo la credencial de prueba
`MP_ACCESS_TOKEN`, una URL HTTPS pública para `MP_WEBHOOK_URL` y las tres URLs de retorno
(`MP_BACK_URL_SUCCESS`, `MP_BACK_URL_FAILURE`, `MP_BACK_URL_PENDING`). Nunca se deben usar credenciales productivas.

El flujo sandbox es: registrar/iniciar sesión, publicar un producto, agregarlo al carrito, crear la orden,
crear una preferencia en `POST /api/pagos/preferencia` y completar el pago con una cuenta de prueba.
Mercado Pago llamará a `POST /api/pagos/webhook`; el backend consulta el pago directamente, valida el monto
contra el total calculado de la orden y sólo cuando el estado es `approved` descuenta la reserva, marca la orden
como pagada y genera el recibo. Los estados rechazado, cancelado, pendiente o expirado nunca completan la venta.

Para probar pagos en sandbox:

1. Crea una aplicación en el panel de desarrolladores de Mercado Pago y usa su `TEST-...` access token en
   `MP_ACCESS_TOKEN`. Crea también un comprador y un vendedor de prueba en el panel; no uses cuentas reales.
2. Expón el backend local con un túnel HTTPS, por ejemplo `ngrok http 3000`, y configura
   `MP_WEBHOOK_URL=https://<tu-subdominio>.ngrok-free.app/api/pagos/webhook`. Esa URL también debe estar
   permitida/configurada como URL de notificaciones de la aplicación en Mercado Pago.
3. Usa un correo de prueba del comprador y las tarjetas de prueba publicadas por Mercado Pago para el país
   México (no una tarjeta real). El backend consulta el pago del webhook, por lo que cerrar el checkout o
   volver a la aplicación no confirma la orden.
4. Configura las URLs de retorno en `.env`; son sólo navegación visual y no son una señal de pago.

## Stack completo con Docker

El frontend Angular 19 se encuentra en [WebProject-main/ProyectoWeb](./WebProject-main/ProyectoWeb).
Configura las variables de [APIWeb-main/.env.example](./APIWeb-main/.env.example) y ejecuta:

```bash
docker compose up --build
```

Los servicios quedan disponibles en:

* Frontend: `http://localhost:4200`
* Backend: `http://localhost:3000`
* Swagger UI: `http://localhost:3000/api-docs`

El frontend usa `http://localhost:3000/api` desde el navegador; no usa el nombre interno
`backend`. 
