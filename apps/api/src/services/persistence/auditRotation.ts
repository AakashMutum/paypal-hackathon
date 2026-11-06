import {
  classifyAuditPayload,
  isSealedAuditPayload,
  openAuditPayload,
  sealAuditPayload,
  type AuditPayloadKey,
} from './auditPrivacy.js';

/**
 * Re-encrypts stored audit payloads under the current key (docs/key-rotation.md).
 *
 * Each payload is decrypted with whichever configured key opens it and sealed again with the
 * current key. The default is a dry run that only counts. Only counts are ever reported: no row
 * data, ids or key material leave this module. Re-running is safe: a payload already sealed with
 * the current key is left alone.
 */

export type RotationTable = 'investigations' | 'payment_events';
export const ROTATION_TABLES: readonly RotationTable[] = ['investigations', 'payment_events'];

export interface RotationRow {
  key: string | number;
  payload: unknown;
}

/** What the rotation needs from storage. Implemented for PostgreSQL and in memory. */
export interface RotationStore {
  begin(): Promise<void>;
  /** The next rows after `after`, in key order. Rows are locked until commit when the store can. */
  readBatch(table: RotationTable, after: string | number | null, limit: number): Promise<RotationRow[]>;
  write(table: RotationTable, key: string | number, payload: unknown): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface TableCounts {
  scanned: number;
  /** Not encrypted (written before encryption was enabled). */
  plaintext: number;
  alreadyCurrent: number;
  /** Sealed with the previous key: rotated, or would be rotated in a dry run. */
  rotated: number;
  /** Plaintext rows sealed because includePlaintext was set. */
  sealedPlaintext: number;
  /** Sealed, but neither configured key opens them. Never modified. */
  unreadable: number;
}

export interface RotationReport {
  applied: boolean;
  includePlaintext: boolean;
  tables: Record<RotationTable, TableCounts>;
}

export interface RotationOptions {
  apply?: boolean;
  /** Also seal rows that were stored as plaintext. Off by default. */
  includePlaintext?: boolean;
  batchSize?: number;
}

const emptyCounts = (): TableCounts => ({
  scanned: 0,
  plaintext: 0,
  alreadyCurrent: 0,
  rotated: 0,
  sealedPlaintext: 0,
  unreadable: 0,
});

export async function rotateAuditEncryption(
  store: RotationStore,
  options: RotationOptions = {},
): Promise<RotationReport> {
  const apply = options.apply === true;
  const includePlaintext = options.includePlaintext === true;
  const batchSize = Math.max(1, Math.min(500, Math.floor(options.batchSize ?? 50)));
  const report: RotationReport = {
    applied: apply,
    includePlaintext,
    tables: { investigations: emptyCounts(), payment_events: emptyCounts() },
  };

  for (const table of ROTATION_TABLES) {
    const counts = report.tables[table];
    let after: string | number | null = null;

    for (;;) {
      await store.begin();
      try {
        const rows = await store.readBatch(table, after, batchSize);
        const batch: TableCounts = emptyCounts();
        const writes: RotationRow[] = [];

        for (const row of rows) {
          batch.scanned += 1;
          const kind: AuditPayloadKey = classifyAuditPayload(row.payload);
          if (kind === 'current') batch.alreadyCurrent += 1;
          else if (kind === 'unreadable') batch.unreadable += 1;
          else if (kind === 'plaintext') {
            batch.plaintext += 1;
            if (includePlaintext) {
              batch.sealedPlaintext += 1;
              writes.push({ key: row.key, payload: sealAuditPayload(row.payload) });
            }
          } else {
            batch.rotated += 1;
            writes.push({ key: row.key, payload: sealAuditPayload(openAuditPayload(row.payload)) });
          }
        }

        if (apply) {
          for (const write of writes) {
            if (!isSealedAuditPayload(write.payload)) {
              throw new Error('Refusing to write: no valid AUDIT_ENCRYPTION_KEY is configured.');
            }
            await store.write(table, write.key, write.payload);
          }
        }
        await store.commit();

        for (const field of Object.keys(batch) as Array<keyof TableCounts>) counts[field] += batch[field];
        if (rows.length < batchSize) break;
        after = rows[rows.length - 1].key;
      } catch (error) {
        await store.rollback().catch(() => undefined);
        throw error;
      }
    }
  }
  return report;
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------------------------

export interface QueryClientLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

export interface PoolLike {
  connect(): Promise<QueryClientLike>;
}

const KEY_COLUMN: Record<RotationTable, { key: string; payload: string }> = {
  investigations: { key: 'id', payload: 'data' },
  payment_events: { key: 'id', payload: 'detail' },
};

/** One short transaction per batch. Rows of the batch are locked with FOR UPDATE until commit. */
export class PgRotationStore implements RotationStore {
  private client: QueryClientLike | undefined;

  /** lock: true takes row locks for the batch (apply); a dry run reads in a read-only transaction. */
  constructor(
    private readonly pool: PoolLike,
    private readonly options: { lock: boolean } = { lock: true },
  ) {}

  async begin(): Promise<void> {
    this.client = await this.pool.connect();
    await this.client.query(this.options.lock ? 'BEGIN' : 'BEGIN READ ONLY');
  }

  async readBatch(table: RotationTable, after: string | number | null, limit: number): Promise<RotationRow[]> {
    const column = KEY_COLUMN[table];
    const where = after === null ? '' : `WHERE ${column.key} > $2`;
    const params: unknown[] = after === null ? [limit] : [limit, after];
    const result = await this.requireClient().query(
      `SELECT ${column.key} AS key, ${column.payload} AS payload FROM ${table} ${where} ORDER BY ${column.key} LIMIT $1${this.options.lock ? ' FOR UPDATE' : ''}`,
      params,
    );
    return result.rows.map((row) => ({ key: row.key as string | number, payload: row.payload }));
  }

  async write(table: RotationTable, key: string | number, payload: unknown): Promise<void> {
    const column = KEY_COLUMN[table];
    await this.requireClient().query(`UPDATE ${table} SET ${column.payload} = $1 WHERE ${column.key} = $2`, [
      JSON.stringify(payload),
      key,
    ]);
  }

  async commit(): Promise<void> {
    await this.requireClient().query('COMMIT');
    this.release();
  }

  async rollback(): Promise<void> {
    try {
      await this.client?.query('ROLLBACK');
    } finally {
      this.release();
    }
  }

  private requireClient(): QueryClientLike {
    if (!this.client) throw new Error('No transaction is open.');
    return this.client;
  }

  private release(): void {
    this.client?.release();
    this.client = undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// In memory (tests and small local checks)
// ---------------------------------------------------------------------------------------------

export class MemoryRotationStore implements RotationStore {
  readonly rows: Record<RotationTable, RotationRow[]> = { investigations: [], payment_events: [] };
  private pending: Array<{ table: RotationTable; key: string | number; payload: unknown }> = [];
  commits = 0;

  async begin(): Promise<void> {
    this.pending = [];
  }

  async readBatch(table: RotationTable, after: string | number | null, limit: number): Promise<RotationRow[]> {
    const sorted = [...this.rows[table]].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return sorted.filter((row) => after === null || row.key > after).slice(0, limit).map((row) => structuredClone(row));
  }

  async write(table: RotationTable, key: string | number, payload: unknown): Promise<void> {
    this.pending.push({ table, key, payload });
  }

  async commit(): Promise<void> {
    for (const write of this.pending) {
      const row = this.rows[write.table].find((candidate) => candidate.key === write.key);
      if (row) row.payload = write.payload;
    }
    this.pending = [];
    this.commits += 1;
  }

  async rollback(): Promise<void> {
    this.pending = [];
  }
}
