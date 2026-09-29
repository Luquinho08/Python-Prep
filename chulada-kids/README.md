# Chulada Kids — tienda online

Tienda web y panel de administración para **Chulada Kids**, papelería creativa y personalizada (Argentina).
Next.js 16 + PostgreSQL, cobros con **Mercado Pago Argentina** (tarjeta dentro de la tienda con Card Payment Brick + Orders API; cuenta de Mercado Pago con Wallet Brick).

| Documento | Para qué |
|---|---|
| [STATUS.md](STATUS.md) | Qué funciona, qué se probó y cómo, qué falta |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Auditoría inicial, etapas y mapa de módulos |
| [DECISIONS.md](DECISIONS.md) | Decisiones de arquitectura y matriz de Mercado Pago |
| [docs/MERCADO_PAGO.md](docs/MERCADO_PAGO.md) | Cómo conectar, probar y salir a producción con MP |
| [docs/ADMIN.md](docs/ADMIN.md) | Manual breve del panel |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Despliegue, tareas programadas, backups y secretos |

## Requisitos

- Node.js 22 (mínimo 20.9) y pnpm 10
- PostgreSQL 16 con las extensiones `unaccent` y `pg_trgm` (las crea la primera migración si el usuario tiene permisos; en Supabase, Neon o RDS están disponibles)

## Puesta en marcha local

```bash
cd chulada-kids
pnpm install
cp .env.example .env            # completar DATABASE_URL y generar los secretos (ver comentarios)
pnpm db:migrate                 # aplica drizzle/*.sql
SEED_USER_PASSWORD='elegí-una-clave-larga' pnpm db:seed   # SOLO desarrollo: datos de demostración
pnpm dev                        # http://localhost:3000
```

Para desarrollar sin credenciales de Mercado Pago, el `.env` puede usar el **simulador local**:
`PAYMENTS_DRIVER=fake` y `ALLOW_FAKE_PAYMENTS=true`. Está rotulado en pantalla como "SIMULADOR LOCAL — NO ES MERCADO PAGO" y queda bloqueado en producción.

Usuarios de prueba que crea el seed (contraseña = `SEED_USER_PASSWORD`):

| Email | Rol |
|---|---|
| owner@chulada.test | Propietario |
| editor@chulada.test | Editor de catálogo |
| operador@chulada.test | Operador de pedidos |
| cliente@chulada.test | Cliente |

Alta real del propietario (sin contraseñas en el código): `pnpm user:create --email duena@dominio.com --role owner` imprime un enlace de invitación de un solo uso.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Desarrollo, build de producción, servidor de producción |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm test` | Vitest: unitarias + integración sobre Postgres real (`chulada_test`) |
| `pnpm test:e2e` | Playwright: levanta `next dev` en :3100 con la base `chulada_e2e` y el simulador |
| `pnpm db:generate` / `pnpm db:migrate` | Generar / aplicar migraciones |
| `pnpm db:seed` | Datos de demostración (se niega a correr con `NODE_ENV=production`) |
| `pnpm cron` | Ejecuta una vez las tareas programadas (conciliación, reservas, webhooks, emails) |

Para `pnpm test`, crear la base `chulada_test` (o definir `TEST_DATABASE_URL`) y migrarla:
`DATABASE_URL=postgres://…/chulada_test pnpm db:migrate`. Para `pnpm test:e2e`, crear `chulada_e2e` con las extensiones; en entornos con Chromium propio usar `PLAYWRIGHT_CHROMIUM_PATH`.

## Estructura

```
src/app/(store)/     tienda pública (inicio, catálogo, ficha, carrito, checkout, cuenta, pedido)
src/app/admin/       panel privado
src/app/api/         webhooks, pagos del checkout, subidas, cron, archivos privados
src/lib/             dominio: pricing, cart, orders, payments, inventory, catalog, auth, storage, email
drizzle/             migraciones SQL
scripts/             migrate, seed, create-user, cron
tests/               unit, integration (Vitest) y e2e (Playwright)
docs/                guías y capturas (docs/screenshots)
```
