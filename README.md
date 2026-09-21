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
