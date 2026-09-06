import { DatabaseSync } from "node:sqlite";
import type {
  AgentRegistration,
  AgentRun,
  CallAttempt,
  Escalation,
  OwnerDecision,
  OwnerInstruction,
} from "./domain.js";
import type { ControlPlaneStore } from "./store.js";

type JsonEntity = AgentRegistration | AgentRun | Escalation | OwnerDecision | OwnerInstruction | CallAttempt | string;

class SqliteBackedMap<T extends JsonEntity> extends Map<string, T> {
  constructor(
    private readonly db: DatabaseSync,
    private readonly table: string,
  ) {
    super();
    this.reload();
  }

  override set(key: string, value: T): this {
    this.db.prepare(`INSERT INTO ${this.table} (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data`).run(
      key,
      JSON.stringify(value),
    );
    return super.set(key, value);
  }

  override delete(key: string): boolean {
    this.db.prepare(`DELETE FROM ${this.table} WHERE key = ?`).run(key);
    return super.delete(key);
  }

  override clear(): void {
    this.db.exec(`DELETE FROM ${this.table}`);
    super.clear();
  }

  reload(): void {
    super.clear();
    const rows = this.db.prepare(`SELECT key, data FROM ${this.table}`).all() as Array<{ key: string; data: string }>;
    for (const row of rows) super.set(row.key, JSON.parse(row.data) as T);
  }
}

class SqliteBackedSet extends Set<string> {
  constructor(
    private readonly db: DatabaseSync,
    private readonly table: string,
  ) {
    super();
    this.reload();
  }

  override add(value: string): this {
    this.db.prepare(`INSERT OR IGNORE INTO ${this.table} (key) VALUES (?)`).run(value);
    return super.add(value);
  }

  override delete(value: string): boolean {
    this.db.prepare(`DELETE FROM ${this.table} WHERE key = ?`).run(value);
    return super.delete(value);
  }

  override clear(): void {
    this.db.exec(`DELETE FROM ${this.table}`);
    super.clear();
  }

  reload(): void {
    super.clear();
    const rows = this.db.prepare(`SELECT key FROM ${this.table}`).all() as Array<{ key: string }>;
    for (const row of rows) super.add(row.key);
  }
}

export class SqliteControlPlaneStore implements ControlPlaneStore {
  readonly agents: SqliteBackedMap<AgentRegistration>;
  readonly runs: SqliteBackedMap<AgentRun>;
  readonly escalations: SqliteBackedMap<Escalation>;
  readonly decisions: SqliteBackedMap<OwnerDecision>;
  readonly instructions: SqliteBackedMap<OwnerInstruction>;
  readonly callAttempts: SqliteBackedMap<CallAttempt>;
  readonly escalationByIdempotencyKey: SqliteBackedMap<string>;
  readonly callbackByIdempotencyKey: SqliteBackedMap<string>;
  readonly processedWebhookEventIds: SqliteBackedSet;

  private readonly reloaders: Array<{ reload(): void }>;
  private transactionDepth = 0;

  constructor(private readonly db: DatabaseSync) {
    this.migrate();
    this.agents = new SqliteBackedMap(db, "agents");
    this.runs = new SqliteBackedMap(db, "runs");
    this.escalations = new SqliteBackedMap(db, "escalations");
    this.decisions = new SqliteBackedMap(db, "decisions");
    this.instructions = new SqliteBackedMap(db, "instructions");
    this.callAttempts = new SqliteBackedMap(db, "call_attempts");
    this.escalationByIdempotencyKey = new SqliteBackedMap(db, "escalation_idempotency");
    this.callbackByIdempotencyKey = new SqliteBackedMap(db, "callback_idempotency");
    this.processedWebhookEventIds = new SqliteBackedSet(db, "webhook_events");
    this.reloaders = [
      this.agents,
      this.runs,
      this.escalations,
      this.decisions,
      this.instructions,
      this.callAttempts,
      this.escalationByIdempotencyKey,
      this.callbackByIdempotencyKey,
      this.processedWebhookEventIds,
    ];
  }

  static open(filename = "callyouragent.db"): SqliteControlPlaneStore {
    const db = new DatabaseSync(filename);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
    return new SqliteControlPlaneStore(db);
  }

  transaction<T>(operation: () => T): T {
    if (this.transactionDepth > 0) return operation();

    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      for (const reloader of this.reloaders) reloader.reload();
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS escalations (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS instructions (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS call_attempts (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS escalation_idempotency (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS callback_idempotency (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS webhook_events (key TEXT PRIMARY KEY);

      CREATE UNIQUE INDEX IF NOT EXISTS ux_escalation_idempotency
        ON escalations(json_extract(data, '$.idempotencyKey'));
      CREATE UNIQUE INDEX IF NOT EXISTS ux_call_attempt_provider_id
        ON call_attempts(json_extract(data, '$.providerCallId'))
        WHERE json_extract(data, '$.providerCallId') IS NOT NULL;
      CREATE INDEX IF NOT EXISTS ix_instruction_run_status
        ON instructions(json_extract(data, '$.runId'), json_extract(data, '$.status'));
      CREATE INDEX IF NOT EXISTS ix_escalation_run_status
        ON escalations(json_extract(data, '$.runId'), json_extract(data, '$.status'));
    `);
  }
}
