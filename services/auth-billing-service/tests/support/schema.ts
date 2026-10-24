import type pg from "pg";

/** Stable fingerprint of the schema objects the migrations own (incl. function bodies). */
export async function schemaFingerprint(pool: pg.Pool) {
  const q = (sql: string) => pool.query(sql).then((r) => r.rows);
  return {
    columns: await q(`
      SELECT table_name, column_name, data_type, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`),
    indexes: await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`),
    functions: await q(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, md5(pg_get_functiondef(p.oid)) AS body
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' ORDER BY 1, 2`),
    enumLabels: await q(`
      SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'credit_transaction_type' ORDER BY e.enumsortorder`),
    triggers: await q(`SELECT tgname, tgrelid::regclass::text AS tbl FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname`),
    constraints: await q(`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace ORDER BY conname`),
  };
}
