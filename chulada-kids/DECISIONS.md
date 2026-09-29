# Decisiones de arquitectura (ADR breve)

Cada decisión indica si es reversible y cómo revertirla.

## D-01 · Ubicación del proyecto
La única fuente con permisos de escritura es `luquinho08/python-prep` (curso de Python). La tienda vive en `chulada-kids/`, autocontenida (su propio `package.json`, lockfile y docs). **Reversible:** copiar la carpeta a un repo nuevo; no hay dependencias con el resto del repositorio.

## D-02 · Stack
- **Next.js 16.3.6** (última estable en npm al 2026-09-28; se descartaron `beta`/`canary`/`preview`), React 19.2.8, TypeScript 5.9.3 (TS 7.0 existe, pero Next 16 se valida con TS 5.x).
- **Tailwind CSS 4.3.3**. Tipografía **Poppins** autoalojada vía `@fontsource/poppins@5.3.0` (sin llamadas a Google en runtime).
- **PostgreSQL 16** + **Drizzle ORM 0.45.3** / drizzle-kit 0.31.11 (migraciones SQL versionadas en `drizzle/`). Driver `postgres@3.4.9`.
- **zod 4.6.5** para validar entradas en el servidor.
- Versiones fijadas en `pnpm-lock.yaml`.

## D-03 · Autenticación y almacenamiento (sin Supabase en esta etapa)
El prompt sugiere Supabase "o similar". En el entorno no hay Docker (no se puede correr Supabase local) ni credenciales de un proyecto Supabase. Para entregar algo **probable localmente de punta a punta**:
- **Auth propia**: sesiones en base de datos (token aleatorio de 256 bits en cookie `HttpOnly; SameSite=Lax; Secure` en producción; en DB solo se guarda su SHA-256), hash de contraseñas **Argon2id** (`@node-rs/argon2`), recuperación por token de un solo uso con vencimiento, rate limit en DB. Roles: `customer`, `owner`, `catalog_editor`, `order_operator`, verificados en **cada** server action / route handler (no se confía en ocultar rutas).
- **Almacenamiento**: adaptador `StorageDriver` con implementación local (`storage/public`, `storage/private`), fuera de `public/`. Archivos privados solo se sirven por una ruta que valida permisos y un enlace firmado de corta duración.
- **Sin RLS**: la base no se expone a clientes; toda consulta pasa por el servidor, que es la autoridad. Si se migra a Supabase, habrá que escribir políticas RLS explícitas (ver `docs/DEPLOY.md`).
- **Reversible**: los módulos `src/lib/auth` y `src/lib/storage` están aislados; se puede cambiar a Supabase Auth/Storage o S3 reemplazando esos adaptadores.

## D-04 · Dinero, fechas, zona horaria
- Importes en **centavos enteros** (`integer`/`bigint`), moneda única ARS. Conversión a string decimal (`"1234.50"`) solo en el adaptador de MP. Redondeo centralizado en `src/lib/money.ts` (half-up a centavo).
- Instantes en `timestamptz` (UTC). Entrada/visualización en `America/Argentina/Buenos_Aires` con conversión por `Intl` (`src/lib/time.ts`), sin asumir offset fijo.

## D-05 · Motor de precios y promociones
- Precio unitario = precio de variante (o base del producto) + recargos de personalización definidos en servidor.
- Promociones (porcentaje o monto fijo; alcance producto/categoría/toda la tienda; vigencia) aplican al precio base/variante, **no** a los recargos.
- **No acumulables por defecto.** Si hay varias vigentes se elige, de forma determinista, la de mayor ahorro (empate → mayor prioridad → id menor). Las marcadas `acumulable` se combinan entre sí y se comparan con la mejor no acumulable; gana la opción de mayor ahorro.
- Cupones sobre el subtotal ya promocionado; si el cupón no es combinable con promociones, se aplica solo a líneas sin promoción. Nunca precio o total negativo.
- El "precio anterior" mostrado es el precio normal real cuando hay promoción vigente; no existe un campo libre "precio tachado".

## D-06 · Stock, capacidad y reservas
- Stock por variante. Productos a pedido usan el mismo contador como **cupos de producción** (`inventory_mode = capacity`), nunca infinito implícito.
- Disponible = existencia − reservas activas vigentes.
- Al crear el pedido (checkout) se reservan unidades en una transacción con `SELECT … FOR UPDATE` sobre las variantes. Reserva por defecto **30 min** (`RESERVATION_MINUTES`).
- Si hay un intento de pago en estado pendiente/en proceso, la reserva **no se libera** sin consultar antes al proveedor; se extiende hasta 72 h máximo (`PENDING_PAYMENT_HOLD_HOURS`).
- Pago aprobado: se consume la reserva (descuenta existencia). Si la reserva venció, se intenta reasignar atómicamente; si no hay stock se abre una **incidencia** (`late_approval_no_stock`) para resolución/reembolso.
- Kits de demo = **packs prearmados** con stock propio (no descuentan componentes).

## D-07 · Idempotencia y concurrencia
- Checkout: el navegador envía una `checkoutKey` (UUID) persistida en `sessionStorage`; `orders.checkout_key` es único → doble clic/reintento devuelve el mismo pedido.
- Pagos: `payment_attempts.idempotency_key` único + header `X-Idempotency-Key` hacia MP (mismo valor en reintentos de red). No se crea un intento nuevo si existe uno no final: primero se concilia con el proveedor.
- `payments.provider_payment_id` único → una aprobación se aplica una sola vez; aprobaciones adicionales del mismo pedido abren incidencia `duplicate_payment`.
- Cupones: reserva de uso con bloqueo de fila del cupón dentro de la transacción del pedido.

## D-08 · Mercado Pago — matriz de integración

> **Fuente:** la documentación web de MP está bloqueada en este entorno. Se verificó contra el código del **SDK oficial** `mercadopago@3.6.1` (npm, 2026-09-22) y `@mercadopago/sdk-react@1.0.7`. Todo lo marcado **(a validar)** debe confirmarse con la documentación vigente antes de producción.

| Opción visible | Componente oficial | API de servidor | Recurso a consultar | Webhook | Retorno |
|---|---|---|---|---|---|
| **Tarjeta de crédito o débito — procesado por Mercado Pago** | **Card Payment Brick** (`@mercadopago/sdk-react` `CardPayment`, SDK JS `https://sdk.mercadopago.com/js/v2`). Tokeniza en el navegador; `onSubmit` entrega `token`, `payment_method_id`, `issuer_id`, `installments`, `payer` y `paymentTypeId`. | **Orders API**: `POST /v1/orders` con `type: "online"`, `processing_mode: "automatic"`, `total_amount`, `external_reference`, `payer.email`, `transactions.payments[{amount, payment_method{id,type,token,installments}}]`, header `X-Idempotency-Key`. | `GET /v1/orders/{id}` (y `GET /v1/orders?external_reference=…` para conciliar). | Tópico **Order** (`type=order`, `data.id` = id de la order) configurado en *Tus integraciones* **(a validar nombre exacto del tópico)**. Firma `x-signature` HMAC-SHA256 (`id:{data.id};request-id:{x-request-id};ts:{ts};`), validada con `WebhookSignatureValidator` del SDK. | En la misma página de checkout: el servidor responde el estado y la tienda muestra el resultado consultando al backend. Si la respuesta trae `payment_method.transaction_security.url` (3DS) se muestra el desafío del emisor y luego se consulta el estado. |
| **Pagar con mi cuenta de Mercado Pago** | **Wallet Brick** (`Wallet`, `initialization.preferenceId`). Abre el entorno de Mercado Pago (aviso visible junto a la opción). | **Preferencias (Checkout Pro)**: `POST /checkout/preferences` con `items`, `external_reference`, `back_urls`, `auto_return`, `notification_url`, `expires/expiration_date_to`, `purpose: "wallet_purchase"` (el SDK lo documenta como "Wallet-only flow"), `statement_descriptor`. | `GET /v1/payments/{id}` y `GET /v1/payments/search?external_reference=…` | Tópico **Pagos** (`type=payment`, `data.id` = id de pago). Misma validación de firma. | `/checkout/resultado?pedido=…`: **no** se usa `collection_status` de la URL como verdad; la página consulta al backend, que consulta a MP. |

- Payment Brick **no** se usa: combina medios en un solo componente y no se verificó su compatibilidad con Orders API en este entorno.
- Ambos adaptadores operan sobre el **mismo pedido interno** (`orders`), cada intento en `payment_attempts` con su `external_reference = attempt.id`. Antes de iniciar un intento con otro método se concilia cualquier intento previo no final.
- Verificaciones al confirmar: `status`, moneda `ARS`, importe = total del pedido, `external_reference` conocido, y cuenta receptora (`collector_id` / `user_id`) = cuenta conectada.
- Mapeo de estados Orders → interno **(a validar con sandbox)**: `processed`+`accredited` → aprobado; `action_required` → requiere acción (3DS); `failed` → rechazado; `processing`/`created` → en proceso; `cancelled`/`canceled` → cancelado; `expired` → vencido; `refunded` → reembolsado; desconocido → **por verificar** (nunca rechazado automático).
- Mapeo Payments API: `approved`/`authorized`* → aprobado (*solo `approved` confirma), `pending`/`in_process`/`in_mediation` → pendiente, `rejected` → rechazado, `cancelled` → cancelado, `refunded` → reembolsado, `charged_back` → contracargo.

## D-09 · Conexión de Mercado Pago (panel)
Tres modos, en orden de precedencia:
1. **Variables de entorno del servidor** (`MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_ENVIRONMENT`). Recomendado cuando la aplicación de MP pertenece a la misma cuenta de Chulada Kids.
2. **Credenciales cargadas por el propietario** en Admin → Pagos: se validan con `GET /users/me` (país `MLA`), se guardan **cifradas AES-256-GCM** con `APP_ENCRYPTION_KEY`; nunca vuelven al navegador.
3. **OAuth Authorization Code** (`OAuth.getAuthorizationURL` / `OAuth.create` / `OAuth.refresh` del SDK): `state` aleatorio de un solo uso ligado a la sesión (10 min), intercambio en backend, tokens cifrados, renovación y detección de revocación (401 → estado `revoked`). **PKCE**: el SDK 3.6.1 no expone parámetros PKCE; queda detrás de `MP_OAUTH_PKCE=true` usando los nombres estándar RFC 7636 **(a validar)**. OAuth está pensado para integradores; si la app es propia, usar modo 1 o 2. No se convierte la tienda en marketplace (sin `marketplace_fee`).
- Desconectar marca la conexión `disconnected`, bloquea cobros nuevos y conserva el historial. Para conciliar operaciones previas hay que reconectar la **misma** cuenta.

## D-10 · Doble de pruebas de pagos
`PAYMENTS_DRIVER=fake` activa un **simulador local claramente rotulado** ("Simulador local — no es Mercado Pago") que implementa la misma interfaz `PaymentGateway`, persiste sus objetos en DB y emite webhooks firmados. Solo se habilita si `NODE_ENV !== "production"` **y** `ALLOW_FAKE_PAYMENTS=true`. Se usa para E2E y pruebas de concurrencia. **No** es una verificación con el proveedor.

## D-11 · Emails
Outbox en DB (`email_outbox`) con `dedupe_key` único, reintentos con backoff. Driver SMTP (`nodemailer`) si hay `SMTP_URL`; si no, el mensaje queda `skipped` con motivo "sin proveedor configurado" (nunca se marca enviado).

## D-12 · Contenido del CMS
HTML de descripciones y páginas se sanitiza con `sanitize-html` y lista blanca estricta (sin `script`, `style`, `on*`, `iframe`). Los enlaces se fuerzan a `http(s)`/`mailto`/`tel`.

## D-14 · Botón de pago del Card Payment Brick
El wrapper `@mercadopago/sdk-react@1.0.7` solo expone `onSubmit` (el hook `useCardPaymentBrick` no ofrece `getFormData`). Por eso la acción que cobra es **el botón propio del Brick**, ubicado junto al resumen final. La etiqueta la define Mercado Pago; la personalización de textos (`customization.visual`) no se verificó. No existe un segundo botón que cobre.

## D-15 · Estados de carga y códigos HTTP
Un `loading.tsx` en la raíz de la tienda hacía streaming y `notFound()` respondía 200. El esqueleto de carga quedó solo en el listado de productos (`productos/(listado)`); el resto de las páginas responde 404 real. Los estados de acción ("Agregando…", "Guardando…", "Preparando…", pago en proceso con autoactualización) cubren la espera.

## D-16 · Retomar el pago por URL
El pedido creado queda en la URL (`/checkout?pedido=…&t=…`). Recargar, volver de Mercado Pago o reintentar retoma el mismo pedido sin duplicarlo. El token es un HMAC del id (256 bits); en la base solo se guarda su SHA-256.

## D-13 · Búsqueda
`unaccent` + `ILIKE` sobre nombre, descripción corta, etiquetas, categorías y temáticas (SKU solo en admin), con índice `pg_trgm`. Suficiente para un catálogo chico/mediano; migrable a búsqueda full-text si crece.
