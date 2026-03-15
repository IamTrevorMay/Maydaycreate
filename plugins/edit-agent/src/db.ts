import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { EditProposal, AgentSession, ProposalStatus } from './types.js';

export class AgentDB {
  private db: Database.Database;

  constructor(dataDir: string) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'edit-agent.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence_id TEXT NOT NULL,
        sequence_name TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        cycle_count INTEGER DEFAULT 0,
        proposals_generated INTEGER DEFAULT 0,
        proposals_accepted INTEGER DEFAULT 0,
        proposals_rejected INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
        edit_type TEXT NOT NULL,
        description TEXT NOT NULL,
        confidence REAL NOT NULL,
        reasoning TEXT NOT NULL,
        action_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        executed_at INTEGER
      );
    `);
  }

  createSession(sequenceId: string, sequenceName: string): number {
    const result = this.db.prepare(
      'INSERT INTO agent_sessions (sequence_id, sequence_name, started_at) VALUES (?, ?, ?)'
    ).run(sequenceId, sequenceName, Date.now());
    return result.lastInsertRowid as number;
  }

  endSession(sessionId: number, stats: { cycleCount: number; generated: number; accepted: number; rejected: number }): void {
    this.db.prepare(
      'UPDATE agent_sessions SET ended_at = ?, cycle_count = ?, proposals_generated = ?, proposals_accepted = ?, proposals_rejected = ? WHERE id = ?'
    ).run(Date.now(), stats.cycleCount, stats.generated, stats.accepted, stats.rejected, sessionId);
  }

  insertProposal(sessionId: number, proposal: Omit<EditProposal, 'id' | 'sessionId'>): number {
    const result = this.db.prepare(`
      INSERT INTO proposals (session_id, edit_type, description, confidence, reasoning, action_json, status, created_at, executed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      proposal.editType,
      proposal.description,
      proposal.confidence,
      proposal.reasoning,
      JSON.stringify(proposal.action),
      proposal.status,
      proposal.createdAt,
      proposal.executedAt,
    );
    return result.lastInsertRowid as number;
  }

  updateProposalStatus(proposalId: number, status: ProposalStatus): void {
    const executedAt = (status === 'executed' || status === 'failed') ? Date.now() : null;
    this.db.prepare(
      'UPDATE proposals SET status = ?, executed_at = COALESCE(?, executed_at) WHERE id = ?'
    ).run(status, executedAt, proposalId);
  }

  getPendingProposals(sessionId: number): EditProposal[] {
    const rows = this.db.prepare(
      'SELECT * FROM proposals WHERE session_id = ? AND status = ? ORDER BY confidence DESC'
    ).all(sessionId, 'pending') as any[];
    return rows.map(r => this.rowToProposal(r));
  }

  getProposalById(proposalId: number): EditProposal | null {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId) as any;
    return row ? this.rowToProposal(row) : null;
  }

  getProposalStats(sessionId?: number): { total: number; accepted: number; rejected: number; executed: number; failed: number; avgConfidenceAccepted: number; avgConfidenceRejected: number } {
    const where = sessionId ? 'WHERE session_id = ?' : '';
    const params = sessionId ? [sessionId] : [];

    const total = (this.db.prepare(`SELECT COUNT(*) as c FROM proposals ${where}`).get(...params) as any).c;
    const accepted = (this.db.prepare(`SELECT COUNT(*) as c FROM proposals ${where ? where + ' AND' : 'WHERE'} status = 'accepted'`).get(...params) as any).c;
    const rejected = (this.db.prepare(`SELECT COUNT(*) as c FROM proposals ${where ? where + ' AND' : 'WHERE'} status = 'rejected'`).get(...params) as any).c;
    const executed = (this.db.prepare(`SELECT COUNT(*) as c FROM proposals ${where ? where + ' AND' : 'WHERE'} status = 'executed'`).get(...params) as any).c;
    const failed = (this.db.prepare(`SELECT COUNT(*) as c FROM proposals ${where ? where + ' AND' : 'WHERE'} status = 'failed'`).get(...params) as any).c;

    const avgAccepted = (this.db.prepare(
      `SELECT AVG(confidence) as avg FROM proposals ${where ? where + ' AND' : 'WHERE'} status IN ('accepted', 'executed')`
    ).get(...params) as any)?.avg || 0;

    const avgRejected = (this.db.prepare(
      `SELECT AVG(confidence) as avg FROM proposals ${where ? where + ' AND' : 'WHERE'} status = 'rejected'`
    ).get(...params) as any)?.avg || 0;

    return { total, accepted: accepted + executed, rejected, executed, failed, avgConfidenceAccepted: avgAccepted, avgConfidenceRejected: avgRejected };
  }

  private rowToProposal(row: any): EditProposal {
    return {
      id: row.id,
      editType: row.edit_type,
      description: row.description,
      confidence: row.confidence,
      reasoning: row.reasoning,
      action: JSON.parse(row.action_json),
      status: row.status,
      createdAt: row.created_at,
      executedAt: row.executed_at,
      sessionId: row.session_id,
    };
  }

  close(): void {
    this.db.close();
  }
}
