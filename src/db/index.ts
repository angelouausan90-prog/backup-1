import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';

// Parse bigint/int8 (OID 20, e.g. COUNT(*)) and numeric (OID 1700, e.g. SUM) as JS numbers
pg.types.setTypeParser(20, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(1700, (val: string) => parseFloat(val));
// Keep timestamp (OID 1114) and date (OID 1082) as formatted strings for API compatibility
pg.types.setTypeParser(1114, (val: string) => val);
pg.types.setTypeParser(1082, (val: string) => val);

export function createPool() {
  const pool = new pg.Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });

  pool.on('error', (err) => {
    console.error('[Cloud SQL] Unexpected idle client error:', err.message);
  });

  return pool;
}

export const pool = createPool();
export const db = drizzle(pool, { schema });
export { schema };
