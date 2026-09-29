# STATUS — Chulada Kids

Actualizado: 2026-09-29. Rama `claude/determined-ptolemy-2qnlk6`, carpeta `chulada-kids/`.

**Niveles de verificación usados:**
- **Probado** = prueba automatizada ejecutada en esta sesión (Vitest sobre Postgres real o Playwright en navegador).
- **Probado con simulador** = flujo de pago ejercitado con el doble local `PAYMENTS_DRIVER=fake` (misma interfaz y mismo código de servidor que el adaptador real, pero **no es Mercado Pago**).
- **Implementado** = código escrito y tipado, sin prueba automatizada específica.
- **Verificado con proveedor** = **ninguno.** La red del entorno bloqueó Mercado Pago.
- **Habilitado en producción** = **nada.** No se desplegó ni se activaron cobros reales.

## Etapas

| Etapa | Estado |
|---|---|
| 1. Auditoría, arquitectura, dependencias | ✅ |
| 2. Tokens de diseño, navegación, catálogo, ficha responsive | ✅ Probado |
| 3. Base de datos, auth, permisos, CRUD admin | ✅ Probado |
| 4. Personalización, destacados, promociones, complementarios, carrito | ✅ Probado |
| 5. Checkout, entregas, métodos de pago, Brick de tarjetas, Wallet, webhooks, conciliación | ✅ Probado con simulador · ⚠️ sin verificación con MP |
| 6. Pedidos, producción, comunicaciones, configuración comercial | ✅ Implementado (flujos críticos probados) |
| 7. Pruebas, revisión visual, documentación | ✅ |

## Criterios de aceptación

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Crear producto en admin, subir imágenes, publicar y verlo en el catálogo | Probado | E2E `admin.spec.ts` |
| 2 | Editar precio/stock/variantes se refleja; los pedidos anteriores se preservan | Probado | E2E cambio de precio; integración "snapshot" |
| 3 | Borradores y archivos privados inaccesibles para anónimos | Probado | E2E 404 de borrador; integración `private-media` 403/200 firmado |
| 4 | Destacados respetan selección/orden; promociones empiezan y vencen en hora de Buenos Aires | Zona horaria: Probado · orden de destacados: Implementado | integración TZ; unitarias `time` |
| 5 | Cupones: límites, sin totales negativos, sin doble uso concurrente | Probado | unitarias + integración concurrente |
| 6 | Complementarios válidos, sin repetir el actual ni inventar | Probado | integración (manuales, matriz + temática/etiqueta, exclusiones) + E2E |
| 7 | Complemento que exige nombre/variante no se agrega incompleto | Probado | E2E ("Elegir opciones"); el servidor revalida |
| 8 | Personalizaciones distintas = líneas separadas; se conservan en carrito y pedido | Probado (script Playwright ad hoc) + integración de snapshot | ver registro 2026-09-28 |
| 9 | Checkout invitado; costo de entrega antes de comprar | Probado | E2E + integración (sin cobertura / dirección obligatoria) |
| 10 | Alterar precio o descuento desde el navegador no altera lo cobrado | Probado | integración (`changed`, `amount_changed`) |
| 11 | Dos compradores del último stock: solo uno confirma | Probado | integración concurrente con `FOR UPDATE` |
| 12 | Doble clic/reintento no duplica; recuperación ante corte | Probado (idempotencia) · reintento de red: Implementado | integración; `payment-step.tsx` reintenta con la misma clave |
| 13 | Conexión de MP persistida de forma segura, con ambiente correcto | Implementado · UI probada en modo simulador | cifrado AES-GCM; OAuth/manual no verificables sin red |
| 14 | "Método de pago" con tarjeta integrada y cuenta MP, manteniendo resumen e importe | Probado con simulador | E2E |
| 15 | Tarjeta con componente oficial; el servidor nunca recibe PAN/CVV | Implementado (Card Payment Brick) · **no verificado con MP** | el endpoint solo acepta token y datos no sensibles |
| 16 | "Comprar" dispara una única operación | Probado (idempotencia) | el botón es el del Brick; integración de misma clave |
| 17 | Cuenta MP: abre flujo, permite cancelar/volver al mismo pedido | Probado con simulador | E2E wallet |
| 18 | Cambiar de método con intento pendiente no genera dos cobros | Probado | integración (pendiente bloquea; preferencia se vence) |
| 19 | Aprobación actualiza una sola vez; retorno falsificado no marca pagado | Probado | integración + E2E |
| 20 | Rechazo, pendiente, firma inválida, webhook duplicado, fuera de orden, timeout, conciliación | Probado | integración `payments` y `webhooks` |
| 21 | Reembolso/cancelación con trazabilidad; aprobación tardía sin sobreventa | Reembolso y aprobación tardía: Probado · cancelación: Implementado | integración |
| 22 | Cliente sin acceso al admin ni a pedidos ajenos; límites por rol | Probado | E2E roles; integración de acceso por token |
| 23 | Móvil/escritorio sin errores visuales, teclado, alt, errores claros | Probado a 360/390/768/1440 | E2E `visual.spec.ts` (sin desborde), foco visible; capturas en `docs/screenshots/` |
| 24 | Controles visibles funcionales | Implementado y recorrido en E2E | — |
| 25 | Build, lint, tipos y pruebas | Probado | ver registro |

## Registro de comandos y resultados (sesión 2026-09-28/29)

| Comando | Resultado |
|---|---|
| `pnpm db:migrate` (dev, test, e2e) | OK (4 migraciones) |
| `pnpm db:seed` ×2 | OK, idempotente |
| `pnpm typecheck` | OK |
| `pnpm lint` | OK (0 errores, 0 advertencias) |
| `pnpm build` | OK, sin advertencias |
| `pnpm test` | **55/55** (28 unitarias + 27 de integración sobre Postgres) |
| `pnpm test:e2e` (Chromium) | **19/19** |
| `pnpm cron` | OK (emails "skipped" por no haber SMTP) |

Bugs encontrados por las pruebas y corregidos: clave de checkout concurrente devolvía "agotado" (se agregó advisory lock), `notFound()` devolvía 200 por streaming del `loading.tsx` global, desborde horizontal del carrito a 360 px, mensaje de rechazo genérico, 3DS sin avance automático, columna duplicada en `sessions`.

## Cómo acceder en desarrollo
Ver `README.md`: `pnpm dev` → http://localhost:3000; panel en `/admin` con `owner@chulada.test` (contraseña = `SEED_USER_PASSWORD`).

## Bloqueos externos y datos que faltan

1. **Mercado Pago (bloqueante para cobrar):** la red del entorno de desarrollo bloqueó `api.mercadopago.com`, `sdk.mercadopago.com` y la documentación. Falta: credenciales de **prueba** (Public Key + Access Token) cargadas por el propietario de forma segura, secreto de webhook, y recorrer `docs/MERCADO_PAGO.md` §6. Validar los puntos "(a validar)" de DECISIONS D-08.
2. **Logo real:** no se pudo leer `Chulada Kids.png` desde Drive. Subirlo en Admin → Configuración (se muestra una marca tipográfica provisional).
3. **Catálogo, precios y fotos reales:** todo el catálogo actual es de demostración (imágenes rotuladas "IMAGEN DE DEMOSTRACIÓN").
4. **Datos comerciales y legales:** email de contacto real, dirección de retiro, razón social, CUIT, políticas (términos, privacidad, cambios, envíos). Las páginas están marcadas como "pendientes".
5. **Entregas:** costos y zonas reales (los actuales dicen "demo").
6. **Email:** proveedor SMTP (`SMTP_URL`). Sin él, los emails quedan registrados como no enviados.
7. **Referencias de diseño:** FotoInk, Danas Candy, Papier y Mercado Libre no se inspeccionaron (sin navegación externa); se siguieron los patrones descritos en el prompt.

## Pasos concretos para producción
1. Elegir hosting con disco persistente + Postgres administrado (docs/DEPLOY.md).
2. Configurar secretos, migrar, crear el propietario con `pnpm user:create`.
3. Cargar logo, datos comerciales, políticas, entregas y catálogo real; desactivar el aviso de demostración.
4. Conectar MP en **prueba**, configurar webhook y cron, recorrer los casos de prueba.
5. Con autorización del propietario: credenciales de producción, habilitar compra y quitar `noindex`.

## Mejoras sugeridas (no bloqueantes)
- Adaptador S3/Supabase Storage para hostings sin disco.
- Kits que descuentan componentes (hoy son packs prearmados con stock propio).
- Editor de texto enriquecido en el admin (hoy texto simple con párrafos).
- Vista previa gráfica de personalización (no se simuló a propósito).
