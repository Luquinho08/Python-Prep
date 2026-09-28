# Chulada Kids — Plan de implementación

Tienda web + panel de administración para **Chulada Kids** (papelería creativa y personalizada, Argentina).
Monolito modular Next.js + PostgreSQL. Un solo comercio receptor de cobros (no marketplace).

## Auditoría inicial (2026-09-28)

| Ítem | Hallazgo | Consecuencia |
|---|---|---|
| Carpeta `C:\Users\Luqui\Desktop\Chulada_Kids` | No accesible: la sesión corre en un contenedor en la nube. El prompt maestro fue pegado en el chat. | Se trabaja desde el prompt pegado. |
| Repositorio disponible | `luquinho08/python-prep` (material de un curso de Python, sin stack web). Rama asignada `claude/determined-ptolemy-2qnlk6`. | La tienda vive aislada en `chulada-kids/` para no mezclar con los ejercicios. Se puede mover a un repo propio sin cambios (ver DECISIONS D-01). |
| Recursos de marca | Google Drive: carpeta compartida `CHULADAKIDS` con `Chulada Kids.png` (≈11 MB) y 5 videos de producto. El PNG no se pudo leer por el conector (contenido vacío) y descargarlo en base64 excedía límites razonables. | Marca tipográfica provisional + carga de logo real desde Admin → Configuración. **Pendiente del propietario.** |
| Runtime | Node 22.22, pnpm 10.33, PostgreSQL 16.13 local, Chromium de Playwright preinstalado. Sin Docker. | Postgres local; Supabase local no es posible sin Docker (ver D-03). |
| Red | `api.mercadopago.com`, `www.mercadopago.com.ar` y `sdk.mercadopago.com` **bloqueados por la política de red del entorno**. npm y Google Fonts accesibles. | La integración de MP se escribe contra el SDK oficial (`mercadopago@3.6.1`, `@mercadopago/sdk-react@1.0.7`) leído desde npm. **No se pudo verificar contra el proveedor.** |
| Referencias (FotoInk, Danas Candy, Papier, Mercado Libre) | No se inspeccionaron en esta sesión (sin navegación externa general). | Se usan solo los patrones descritos en el prompt; no se afirma auditoría. |

## Etapas

1. **Auditoría, arquitectura, dependencias** — este documento, `DECISIONS.md`, `STATUS.md`, scaffold.
2. **Diseño y catálogo** — tokens de marca, layout, home editable, catálogo con búsqueda/filtros en URL, ficha con galería.
3. **Datos, auth y admin** — esquema + migraciones (Drizzle), seed de desarrollo, sesiones, roles, CRUD de productos/variantes/imágenes/categorías/temáticas.
4. **Personalización, promociones, complementarios, carrito** — motor de precios central, cupones atómicos, relaciones manuales + matriz automática, carrito server-side.
5. **Checkout y pagos** — pedido pendiente + reservas, entrega por zonas/CP, método de pago (Card Payment Brick + Orders API; Wallet Brick + Preferencias), webhooks firmados, conciliación, OAuth/credenciales manuales cifradas.
6. **Operación** — pedidos, estados de pago vs. producción, aprobación de diseño, notas, CSV, reembolsos/cancelaciones, outbox de emails, cuenta del cliente y acceso de invitado.
7. **Calidad** — pruebas de negocio (Vitest sobre Postgres real), E2E (Playwright), capturas 360/390/768/1440, lint/tipos/build, guías.

## Mapa de requisitos → módulos

| Requisito | Módulo |
|---|---|
| Precios, promociones, cupones, redondeo | `src/lib/pricing/*` (funciones puras, testeadas) |
| Stock y reservas | `src/lib/inventory/*` (transacciones + `FOR UPDATE`) |
| Complementarios | `src/lib/catalog/complements.ts` |
| Carrito | `src/lib/cart/*` (cookie con token opaco, datos en DB) |
| Checkout / pedidos | `src/lib/orders/*` |
| Pagos | `src/lib/payments/*` (gateway MP real + doble de pruebas explícito) |
| Webhooks / conciliación | `src/app/api/webhooks/mercadopago`, `src/lib/payments/reconcile.ts`, `scripts/cron.ts` |
| Auth / roles | `src/lib/auth/*` |
| Archivos | `src/lib/storage/*` (público vs. privado) |
| Emails | `src/lib/email/*` (outbox con reintentos y deduplicación) |
| Contenido | `src/lib/content/*` (sanitización estricta) |
