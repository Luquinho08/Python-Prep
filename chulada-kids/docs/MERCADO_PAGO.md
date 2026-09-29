# Guía de Mercado Pago — Chulada Kids

> **Estado honesto:** la integración está **implementada** contra el SDK oficial (`mercadopago@3.6.1`, `@mercadopago/sdk-react@1.0.7`) y **probada con el simulador local**. **No fue verificada con Mercado Pago**: en el entorno de desarrollo, `api.mercadopago.com`, `sdk.mercadopago.com` y la documentación estaban bloqueados por la política de red. Los puntos marcados **(a validar)** en `DECISIONS.md` (D-08) deben confirmarse con la documentación vigente y el ambiente de prueba antes de cobrar.

## 1. Qué ve el comprador

En el checkout, sección **Método de pago**:

| Opción | Componente | Servidor | Qué pasa |
|---|---|---|---|
| Tarjeta de crédito o débito — procesado por Mercado Pago | Card Payment Brick (formulario seguro de MP dentro de la tienda) | `POST /api/checkout/{pedido}/card` → Orders API `POST /v1/orders` | Número y código de seguridad nunca pasan por nuestro servidor: el Brick los tokeniza. El botón de pago es el del Brick (único que cobra). |
| Pagar con mi cuenta de Mercado Pago | Wallet Brick (`preferenceId`) | `POST /api/checkout/{pedido}/wallet` → `POST /checkout/preferences` (`purpose: wallet_purchase`) | Se abre el entorno de MP; al terminar o cancelar vuelve a `/checkout/resultado`, que consulta al backend (no confía en los parámetros de retorno). |

Ambas opciones cobran el **mismo pedido interno**. Antes de iniciar un intento nuevo se concilian los anteriores: si hay uno pendiente no se permite otro, y una preferencia sin pagos se vence en el proveedor antes de cambiar a tarjeta.

## 2. Requisitos previos (propietario)

1. Cuenta de Mercado Pago **Argentina** del comercio, verificada y habilitada para cobrar.
2. Aplicación en **Mercado Pago Developers** configurada para *Checkout API (Orders)* y *Checkout Bricks*. Si reutilizás una aplicación existente, verificá que tenga habilitados esos productos.
3. **Public Key** y **Access Token** del mismo comercio y del mismo ambiente (prueba o producción).
4. Dominio con **HTTPS**, servidor Node y base PostgreSQL, y URL pública para notificaciones.

## 3. Conectar

Hay tres modos (Admin → Medios de pago muestra cuál está activo, el ambiente y la cuenta, sin revelar secretos):

1. **Variables de entorno (recomendado si la app de MP es de la cuenta de Chulada Kids):** `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_ENVIRONMENT=test|production`. Cargalas en el gestor de secretos del hosting. Luego "Verificar conexión" consulta `/users/me` y fija la cuenta receptora.
2. **Credenciales cargadas por el propietario:** en Admin → Medios de pago. Se validan con MP (país `MLA`), se guardan cifradas con AES-256-GCM (`APP_ENCRYPTION_KEY`) y no vuelven al navegador. Para producción se exige confirmar que las pruebas terminaron.
3. **OAuth:** botón "Conectar Mercado Pago" si existen `MP_CLIENT_ID`, `MP_CLIENT_SECRET` y `MP_OAUTH_REDIRECT_URI` (= `https://TU-DOMINIO/api/admin/mercadopago/oauth/callback`, registrado en la app). `state` de un solo uso ligado a la sesión, intercambio en el servidor, tokens cifrados, renovación automática (cron) y detección de revocación. PKCE: `MP_OAUTH_PKCE=true` **(a validar)**. OAuth está pensado para integradores; no convierte la tienda en marketplace.

**Nunca** pegues el Access Token en un chat, email o ticket.

**Desconectar** bloquea cobros nuevos y conserva el historial. Para conciliar pagos anteriores hay que reconectar la misma cuenta.

## 4. Notificaciones (webhooks)

En *Tus integraciones → tu aplicación → Webhooks*:

- URL: `https://TU-DOMINIO/api/webhooks/mercadopago`
- Tópicos: **Order** (Orders API) y **Pagos** (Wallet/preferencias). **(a validar: nombres exactos de los tópicos en el panel)**
- Copiá la **clave secreta** a `MP_WEBHOOK_SECRET`.

Cada notificación: se valida la firma `x-signature` con `WebhookSignatureValidator` del SDK (se prueba `data.id` tal cual y en minúsculas), se guarda en `webhook_events` **antes** de responder 200, y se procesa consultando el recurso oficial (`GET /v1/orders/{id}` o `GET /v1/payments/{id}`). Se verifican moneda (ARS), importe, `external_reference` y cuenta receptora. Los eventos repetidos o fuera de orden no duplican nada. Si el procesamiento falla, el cron lo reintenta.

## 5. Tareas programadas (obligatorio)

Cada 5 minutos: `POST https://TU-DOMINIO/api/cron/run` con `Authorization: Bearer $CRON_SECRET` (o `pnpm cron`). Concilia intentos pendientes (por si falla una notificación), reintenta webhooks, vence reservas, renueva tokens OAuth, envía emails y limpia archivos huérfanos.

## 6. Probar en ambiente de prueba

1. Configurá credenciales **de prueba** (modo 1 o 2) y `PAYMENTS_DRIVER=mercadopago`.
2. Usá las tarjetas y usuarios de prueba que indica la documentación **de Checkout API (Orders) / Card Payment Brick** (no reutilices instrucciones de Checkout Pro).
3. Casos a recorrer: aprobado, rechazado, pendiente, 3DS (si hay escenario oficial), cancelación en Wallet, webhook duplicado, reembolso parcial y total desde el panel.
4. Confirmá en Admin → Pedidos → detalle: intentos, pagos, eventos y que el pedido se aprobó una sola vez.

Verificar en la documentación vigente **(a validar)**: mapeo de `status`/`status_detail` de Orders (D-08), parámetros de 3DS (`MP_3DS_VALIDATION`), cómo mostrar el desafío 3DS (hoy se muestra la URL de `transaction_security` en un iframe), y si el Wallet Brick requiere algún campo adicional de la preferencia.

## 7. Salir a producción

- [ ] Pruebas del punto 6 completas y documentadas.
- [ ] Credenciales de **producción** del mismo comercio; `MP_ENVIRONMENT=production`.
- [ ] Webhook de producción con su secreto propio.
- [ ] Revisar la guía oficial "Salir a producción" de Checkout API (Orders).
- [ ] Autorización explícita del propietario para cobros reales.
- [ ] `PAYMENTS_DRIVER=mercadopago` (el simulador no arranca con `NODE_ENV=production`).
