# STATUS — Chulada Kids

Leyenda: **Implementado** (código listo) · **Probado local** (verificado en esta máquina) · **Probado con mocks** (simulador de pagos) · **Verificado con proveedor** · **Producción**.

## Avance por etapa

| Etapa | Estado |
|---|---|
| 1. Auditoría, arquitectura, dependencias | ✅ Completa (ver IMPLEMENTATION_PLAN.md y DECISIONS.md) |
| 2. Diseño, navegación, catálogo, ficha | ✅ Implementado y probado local |
| 3. DB, auth, permisos, CRUD admin | 🟡 DB + migraciones + seed + auth base listas; admin en curso |
| 4. Personalización, promos, complementarios, carrito | 🟡 Motor de precios, personalización, complementarios y carrito listos; admin de promos/cupones en curso |
| 5. Checkout y pagos | ⏳ Pendiente |
| 6. Pedidos y operación | ⏳ Pendiente |
| 7. Pruebas y documentación final | ⏳ Pendiente |

## Registro de comandos y resultados

| Fecha | Comando | Resultado |
|---|---|---|
| 2026-09-28 | `npx create-next-app@16.3.6` | OK |
| 2026-09-28 | `pnpm db:migrate` (dev y test) | OK, 3 migraciones |
| 2026-09-28 | `pnpm db:seed` ×2 | OK, idempotente (14 productos, 36 medios tras 2 corridas) |
| 2026-09-28 | `tsc --noEmit` | OK |
| 2026-09-28 | Búsquedas `curl` (`CUMPLEAÑOS`, `invitacion dino`, `etiketas`, `agenda`) | 3 / 2 / 0 + sugerencias / 0 (borrador oculto) |
| 2026-09-28 | Flujo Playwright: personalizar → agregar ×3 → carrito → cupón | Errores de campo visibles; mismo nombre se fusiona, nombre distinto = línea separada; cupón aplicado |
| 2026-09-28 | Capturas 390 y 1440 px de inicio, ficha y carrito | Sin desbordamiento horizontal (`scrollWidth − clientWidth = 0`) |

## Bloqueos externos conocidos

- **Mercado Pago**: `api.mercadopago.com`, `sdk.mercadopago.com` y la documentación están bloqueados por la política de red del entorno de desarrollo. No se puede verificar con el proveedor desde aquí.
- **Logo real**: no se pudo leer `Chulada Kids.png` desde Drive. Pendiente de carga por el propietario.

## Siguiente paso

Páginas de cuenta (ingresar/registro/recuperación), panel admin (productos, variantes, imágenes, categorías, promociones, cupones, complementarios, contenido), luego checkout + pagos.
