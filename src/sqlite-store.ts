import { DatabaseSync } from "node:sqlite";
import type {
  AgentRegistration,
  AgentRun,
  AuditEvent,
  CallAttempt,
  Escalation,
  OwnerDecision,
  OwnerInstruction,
} from "./domain.js";
import type { CallTerminalOutcomeClaim, CallTerminalOutcomeClaimResult, ControlPlaneStore, RunMutationResult } from "./store.js";

type JsonEntity = AgentRegistration | AgentRun | Escalation | OwnerDecision | OwnerInstruction | CallAttempt | AuditEvent | CallTerminalOutcomeClaim | string;

class SqliteBackedMap<T extends JsonEntity> extends Map<string, T> {
  constructor(
    protected readonly db: DatabaseSync,
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

class SqliteAuditEventMap extends SqliteBackedMap<AuditEvent> {
  override set(key: string, value: AuditEvent): this {
    const existing = this.get(key);
    if (existing) {
      value.sequence = existing.sequence;
      return super.set(key, value);
    }

    const row = this.db.prepare(`
      UPDATE audit_sequence
      SET next_sequence = next_sequence + 1
      WHERE key = 1
      RETURNING next_sequence - 1 AS sequence
    `).get() as { sequence: number } | undefined;
    if (!row) throw new Error("Failed to allocate audit event sequence");
    value.sequence = Number(row.sequence);
    return super.set(key, value);
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
  readonly auditEvents: SqliteAuditEventMap;
  readonly escalationByIdempotencyKey: SqliteBackedMap<string>;
  readonly callbackByIdempotencyKey: SqliteBackedMap<string>;
  readonly decisionByEscalationId: SqliteBackedMap<string>;
  readonly terminalOutcomeClaims: SqliteBackedMap<CallTerminalOutcomeClaim>;
  readonly processedWebhookEventIds: SqliteBackedSet;
  readonly callbackInstructionSetClaims: SqliteBackedSet;

  private readonly reloaders: Array<{ reload(): void }>;
  private transactionDepth = 0;
  private closed = false;

  constructor(private readonly db: DatabaseSync) {
    this.migrate();
    this.agents = new SqliteBackedMap(db, "agents");
    this.runs = new SqliteBackedMap(db, "runs");
    this.escalations = new SqliteBackedMap(db, "escalations");
    this.decisions = new SqliteBackedMap(db, "decisions");
    this.instructions = new SqliteBackedMap(db, "instructions");
    this.callAttempts = new SqliteBackedMap(db, "call_attempts");
    this.auditEvents = new SqliteAuditEventMap(db, "audit_events");
    this.escalationByIdempotencyKey = new SqliteBackedMap(db, "escalation_idempotency");
    this.callbackByIdempotencyKey = new SqliteBackedMap(db, "callback_idempotency");
    this.decisionByEscalationId = new SqliteBackedMap(db, "decision_by_escalation");
    this.terminalOutcomeClaims = new SqliteBackedMap(db, "call_terminal_outcomes");
    this.processedWebhookEventIds = new SqliteBackedSet(db, "webhook_events");
    this.callbackInstructionSetClaims = new SqliteBackedSet(db, "callback_instruction_sets");
    this.reloaders = [
      this.agents,
      this.runs,
      this.escalations,
      this.decisions,
      this.instructions,
      this.callAttempts,
      this.auditEvents,
      this.escalationByIdempotencyKey,
      this.callbackByIdempotencyKey,
      this.decisionByEscalationId,
      this.terminalOutcomeClaims,
      this.processedWebhookEventIds,
      this.callbackInstructionSetClaims,
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
      this.reloadAll();
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  updateRunIfCurrent(runId: string, expectedUpdatedAt: string, next: AgentRun): RunMutationResult {
    this.runs.reload();
    const current = this.runs.get(runId);
    if (!current) throw new Error(`Unknown run: ${runId}`);
    if (current.updatedAt !== expectedUpdatedAt) return { run: structuredClone(current), applied: false };
    this.runs.set(runId, structuredClone(next));
    return { run: structuredClone(next), applied: true };
  }

  bindEscalationIdempotencyKey(key: string, escalationId: string): string {
    return this.bindUniqueMapValue(this.escalationByIdempotencyKey, "escalation_idempotency", key, escalationId);
  }

  bindCallbackIdempotencyKey(key: string, callAttemptId: string): string {
    return this.bindUniqueMapValue(this.callbackByIdempotencyKey, "callback_idempotency", key, callAttemptId);
  }

  bindDecisionToEscalation(escalationId: string, decisionId: string): string {
    return this.bindUniqueMapValue(this.decisionByEscalationId, "decision_by_escalation", escalationId, decisionId);
  }

  claimCallTerminalOutcome(callAttemptId: string, claim: CallTerminalOutcomeClaim): CallTerminalOutcomeClaimResult {
    const result = this.db.prepare("INSERT OR IGNORE INTO call_terminal_outcomes (key, data) VALUES (?, ?)").run(
      callAttemptId,
      JSON.stringify(claim),
    );
    const row = this.db.prepare("SELECT data FROM call_terminal_outcomes WHERE key = ?").get(callAttemptId) as { data: string } | undefined;
    if (!row) throw new Error("Failed to claim terminal outcome");
    const claimed = Number(result.changes) === 1;
    if (claimed) this.terminalOutcomeClaims.reload();
    else this.reloadAll();
    return { winner: JSON.parse(row.data) as CallTerminalOutcomeClaim, claimed };
  }

  claimCallbackInstructionSet(callAttemptId: string): boolean {
    return this.claimUniqueSetValue(this.callbackInstructionSetClaims, "callback_instruction_sets", callAttemptId);
  }

  claimWebhookEventId(eventId: string): boolean {
    return this.claimUniqueSetValue(this.processedWebhookEventIds, "webhook_events", eventId);
  }

  close(): void {
    if (this.closed) return;
    try {
      // Truncate the WAL before closing so Windows can release the database
      // directory immediately after short-lived worker/test processes exit.
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // Another connection may own a read transaction. Closing still releases
      // this store's handles and preserves the durable WAL for that connection.
    } finally {
      this.db.close();
      this.closed = true;
    }
  }

  private reloadAll(): void {
    for (const reloader of this.reloaders) reloader.reload();
  }

  private bindUniqueMapValue(map: SqliteBackedMap<string>, table: string, key: string, value: string): string {
    this.db.prepare(`INSERT OR IGNORE INTO ${table} (key, data) VALUES (?, ?)`).run(key, JSON.stringify(value));
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE key = ?`).get(key) as { data: string } | undefined;
    if (!row) throw new Error(`Failed to bind unique key in ${table}`);
    const winner = JSON.parse(row.data) as string;
    map.reload();
    return winner;
  }

  private claimUniqueSetValue(set: SqliteBackedSet, table: string, value: string): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO ${table} (key) VALUES (?)`).run(value);
    set.reload();
    return Number(result.changes) === 1;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS escalations (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS instructions (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS call_attempts (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_events (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS escalation_idempotency (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS callback_idempotency (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decision_by_escalation (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS call_terminal_outcomes (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS webhook_events (key TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS callback_instruction_sets (key TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS audit_sequence (key INTEGER PRIMARY KEY CHECK (key = 1), next_sequence INTEGER NOT NULL);
      INSERT OR IGNORE INTO audit_sequence(key, next_sequence)
      VALUES (1, COALESCE((SELECT MAX(json_extract(data, '$.sequence')) FROM audit_events), 0) + 1);
      CREATE UNIQUE INDEX IF NOT EXISTS call_attempt_provider_call_id_unique
      ON call_attempts (json_extract(data, '$.providerCallId'))
      WHERE json_extract(data, '$.providerCallId') IS NOT NULL;
    `);
  }
}
