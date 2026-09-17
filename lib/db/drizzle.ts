import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import dotenv from 'dotenv';

type PostgresClient = postgres.Sql;

dotenv.config();

if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL environment variable is not set');
}

const connectionOptions =
  process.env.NODE_ENV === 'production'
    ? { max: 10 }
    : { idle_timeout: 5, max: 1 };

const globalForDatabase = globalThis as typeof globalThis & {
  postgresClient?: PostgresClient;
};

export const client =
  globalForDatabase.postgresClient ??
  postgres(process.env.POSTGRES_URL, connectionOptions);

if (process.env.NODE_ENV !== 'production') {
  globalForDatabase.postgresClient = client;
}

export const db = drizzle(client, { schema });
