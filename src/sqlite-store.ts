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
import type { CallTerminalOutcomeClaim, CallTerminalOutcomeClaimResult, ControlPlaneStore } from "./store.js";

type JsonEntity = AgentRegistration | AgentRun | Escalation | OwnerDecision | OwnerInstruction | CallAttempt | AuditEvent | CallTerminalOutcomeClaim | string;

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
  readonly auditEvents: SqliteBackedMap<AuditEvent>;
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
    this.auditEvents = new SqliteBackedMap(db, "audit_events");
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
    // A losing connection may have stale in-memory entity mirrors from before the
    // winning transaction committed. Refresh all mirrors before returning so the
    // control plane can converge to the winner without rewriting stale state.
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
    this.db.close();
    this.closed = true;
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

      CREATE UNIQUE INDEX IF NOT EXISTS ux_escalation_idempotency
        ON escalations(json_extract(data, '$.idempotencyKey'));
      CREATE UNIQUE INDEX IF NOT EXISTS ux_decision_escalation
        ON decisions(json_extract(data, '$.escalationId'));
      CREATE UNIQUE INDEX IF NOT EXISTS ux_call_attempt_provider_id
        ON call_attempts(json_extract(data, '$.providerCallId'))
        WHERE json_extract(data, '$.providerCallId') IS NOT NULL;
      CREATE INDEX IF NOT EXISTS ix_instruction_run_status
        ON instructions(json_extract(data, '$.runId'), json_extract(data, '$.status'));
      CREATE INDEX IF NOT EXISTS ix_escalation_run_status
        ON escalations(json_extract(data, '$.runId'), json_extract(data, '$.status'));
      CREATE INDEX IF NOT EXISTS ix_audit_event_run_created
        ON audit_events(json_extract(data, '$.runId'), json_extract(data, '$.createdAt'));
      CREATE INDEX IF NOT EXISTS ix_audit_event_agent_created
        ON audit_events(json_extract(data, '$.agentId'), json_extract(data, '$.createdAt'));
    `);
  }
}
