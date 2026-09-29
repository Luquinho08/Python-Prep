# Guía de despliegue — Chulada Kids

No se desplegó nada ni se contrató ningún servicio. Esta guía describe cómo hacerlo cuando el propietario lo autorice.

## Arquitectura a desplegar
- **Aplicación**: Next.js 16 en modo servidor Node (`pnpm build && pnpm start`). Monolito: tienda, panel, webhooks y cron en el mismo proceso.
- **Base de datos**: PostgreSQL 16 administrado (Neon, Supabase Postgres, RDS, Railway, Render…) con `unaccent` y `pg_trgm`.
- **Archivos**: `STORAGE_DIR` necesita **disco persistente** (VPS, Render/Railway con volumen). En plataformas sin disco persistente (p. ej. serverless), reemplazar `src/lib/storage` por un adaptador S3/Supabase Storage antes de publicar (ver DECISIONS D-03).
- **Tareas programadas**: llamada cada 5 minutos a `/api/cron/run`.

Opción recomendada por simplicidad: un servicio Node con volumen persistente + Postgres administrado en la misma región (cercana a Argentina).

## Variables de entorno (secretos)
Ver `.env.example`. Obligatorias en producción:

| Variable | Notas |
|---|---|
| `APP_URL` | `https://tu-dominio` (sin barra final) |
| `DATABASE_URL` | Con SSL si el proveedor lo exige |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32`. Si se pierde, las credenciales de MP guardadas no se pueden descifrar |
| `APP_SIGNING_SECRET` | `openssl rand -base64 32` |
| `CRON_SECRET` | `openssl rand -hex 24` |
| `MP_*` | Ver docs/MERCADO_PAGO.md |
| `SMTP_URL`, `EMAIL_FROM`, `ADMIN_NOTIFICATION_EMAIL` | Sin SMTP los emails quedan "skipped" (no se envían) |
| `PAYMENTS_DRIVER=mercadopago` | El simulador no arranca en producción |

Nunca subir `.env` al repositorio.

## Pasos
1. Crear la base y habilitar extensiones: `CREATE EXTENSION unaccent; CREATE EXTENSION pg_trgm;` (si el usuario de la app no tiene permisos).
2. `pnpm install --frozen-lockfile && pnpm db:migrate && pnpm build`.
3. **No** correr `pnpm db:seed` en producción (el script se niega).
4. `pnpm start` (puerto `PORT`, detrás de HTTPS).
5. Crear el propietario: `pnpm user:create --email … --role owner` y abrir el enlace.
6. Admin → Configuración: datos del comercio, logo, políticas; Entregas con valores reales; Medios de pago.
7. Cron: cron del sistema o del hosting → `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron/run` cada 5 min.
8. Webhook en Mercado Pago apuntando a `https://tu-dominio/api/webhooks/mercadopago`.
9. Habilitar la compra en Configuración y quitar el `noindex` cuando el catálogo sea real.

## Migraciones
- Generar con `pnpm db:generate` (a partir de `src/lib/db/schema.ts`), revisar el SQL y aplicar con `pnpm db:migrate` **antes** de desplegar el código nuevo. Preferir cambios aditivos.

## Backups y restauración
- Activar backups automáticos del proveedor (diarios con retención ≥ 7 días y PITR si está disponible).
- Respaldar también `STORAGE_DIR` (imágenes y referencias privadas).
- Restaurar: `pg_restore` o PITR en una base nueva → apuntar `DATABASE_URL` → `pnpm db:migrate` → verificar `/api/health?db=1`. Probar la restauración al menos una vez.

## Monitoreo y errores
- `/api/health` (proceso) y `/api/health?db=1` (base) para uptime.
- Revisar en el panel: incidencias abiertas, webhooks con firma inválida o fallidos (Admin → Medios de pago) y emails fallidos (`email_outbox`).
- Los logs no incluyen tokens ni datos de tarjeta; el cuerpo de los webhooks se guarda para auditoría.

## Datos personales
- Referencias privadas no usadas se borran a los 7 días (cron). Las de pedidos se conservan con el pedido; definir con el propietario un plazo de retención (p. ej. 12 meses) y ampliar `purgeOrphanPrivateUploads` en consecuencia.
- Las políticas de privacidad y términos deben redactarse antes de publicar.

## Si se migra a Supabase
- Postgres: compatible (usar la cadena de conexión directa para migraciones).
- Auth/Storage: reemplazar `src/lib/auth` y `src/lib/storage`. Si se exponen tablas al cliente, escribir **políticas RLS explícitas** y probarlas; la `service_role` solo en el servidor.
