// Rolls back the most recently applied migration.
//
// drizzle-kit only generates "up" SQL, so rollback isn't built in. This script expects a
// hand-written `<tag>.down.sql` next to each generated `<tag>.sql` migration (create one
// whenever you add a migration that needs to be reversible), and undoes the DB-side
// bookkeeping drizzle-kit's migrator uses to track what's applied.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { dbConfig } from '../app/config/db.conf.js';

const MIGRATIONS_DIR = path.resolve('migrations');
const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';

type JournalEntry = { tag: string; when: number };

async function main(): Promise<void> {
  const sql = postgres(dbConfig.url, { max: 1 });

  try {
    const [lastApplied] = await sql<{ hash: string; created_at: string }[]>`
      select hash, created_at
      from ${sql(MIGRATIONS_SCHEMA)}.${sql(MIGRATIONS_TABLE)}
      order by created_at desc
      limit 1
    `;

    if (!lastApplied) {
      console.log('No applied migrations found — nothing to roll back.');
      return;
    }

    const journal = JSON.parse(
      fs.readFileSync(
        path.join(MIGRATIONS_DIR, 'meta', '_journal.json'),
        'utf-8',
      ),
    ) as { entries: JournalEntry[] };

    const entry = journal.entries.find(
      (e) => String(e.when) === lastApplied.created_at,
    );
    if (!entry) {
      throw new Error(
        `Could not find a journal entry matching applied migration (created_at=${lastApplied.created_at}).`,
      );
    }

    const downPath = path.join(MIGRATIONS_DIR, `${entry.tag}.down.sql`);
    if (!fs.existsSync(downPath)) {
      throw new Error(
        `No down migration found at ${downPath}. Add one alongside ${entry.tag}.sql to make it reversible.`,
      );
    }

    const downSql = fs.readFileSync(downPath, 'utf-8');
    const statements = downSql.split('--> statement-breakpoint');

    await sql.begin(async (tx) => {
      for (const statement of statements) {
        if (statement.trim()) {
          await tx.unsafe(statement);
        }
      }
      await tx`
        delete from ${tx(MIGRATIONS_SCHEMA)}.${tx(MIGRATIONS_TABLE)}
        where hash = ${lastApplied.hash}
      `;
    });

    console.log(`Rolled back migration: ${entry.tag}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
