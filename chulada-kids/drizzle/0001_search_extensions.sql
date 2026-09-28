-- Extensiones para búsqueda tolerante a tildes (requieren permisos de owner/superusuario;
-- en proveedores administrados (Supabase, Neon, RDS) están disponibles).
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- unaccent() y array_to_string() no son IMMUTABLE; estos wrappers permiten indexar.
CREATE OR REPLACE FUNCTION ck_normalize(input text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, coalesce(input, ''))) $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION ck_product_search_text(p_name text, p_short text, p_tags text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT ck_normalize(coalesce(p_name, '') || ' ' || coalesce(p_short, '') || ' ' || coalesce(array_to_string(p_tags, ' '), '')) $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS products_search_trgm_idx ON products
  USING gin (ck_product_search_text(name, short_description, tags) gin_trgm_ops);
