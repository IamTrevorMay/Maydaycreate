import path from 'path';
import { definePlugin } from '@mayday/sdk';
import type { PluginContext, Sequence } from '@mayday/sdk';
import { AgentDB } from './db.js';
import { buildAnalysisPrompt, getSystemPrompt } from './prompt-builder.js';
import { parseResponse } from './response-parser.js';
import { executeProposal } from './action-executor.js';
import { ExampleBank } from '../../cutting-board/src/example-bank.js';
import { CuttingBoardDB } from '../../cutting-board/src/db.js';
import { computeCalibration } from './learning.js';
import type { AgentMode, AgentState, EditProposal } from './types.js';

const LOOP_INTERVAL = 10_000; // 10 seconds

let db: AgentDB | null = null;
let agentState: AgentState = {
  mode: 'suggest',
  running: false,
  cycleCount: 0,
  lastAnalysisTime: null,
  lastTimelineHash: null,
  proposals: [],
  sessionId: null,
  exampleCount: 0,
};
let loopTimer: ReturnType<typeof setInterval> | null = null;
let exampleBank: ExampleBank | null = null;
let eventSubs: Array<{ unsubscribe(): void }> = [];

function computeTimelineHash(seq: Sequence): string {
  // Simple hash from clip positions
  const parts: string[] = [];
  for (const track of [...seq.videoTracks, ...seq.audioTracks]) {
    for (const clip of track.clips) {
      parts.push(`${clip.trackIndex}:${clip.start.toFixed(3)}:${clip.end.toFixed(3)}`);
    }
  }
  // Simple string hash
  let hash = 0;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function loadExampleBank(cuttingBoardDataDir: string): ExampleBank {
  if (!exampleBank) {
    exampleBank = new ExampleBank();
  }
  try {
    const cbDb = new CuttingBoardDB(cuttingBoardDataDir);
    const records = cbDb.getQualityRecords();
    exampleBank.load(records);
    cbDb.close();
  } catch {
    // cutting-board may not have data yet
  }
  return exampleBank;
}

function getCuttingBoardDataDir(agentDataDir: string): string {
  // Navigate from plugins/edit-agent/data to plugins/cutting-board/data
  return path.resolve(agentDataDir, '..', '..', 'cutting-board', 'data');
}

async function runAnalysis(ctx: PluginContext, userInstruction?: string): Promise<EditProposal[]> {
  const seq = await ctx.services.timeline.getActiveSequence();
  if (!seq) {
    ctx.log.warn('No active sequence');
    return [];
  }

  // Load example bank from cutting-board data
  const bank = loadExampleBank(getCuttingBoardDataDir(ctx.dataDir));
  agentState.exampleCount = bank.size;

  const bestExamples = bank.getBestExamples(10);

  // Get proposal stats for calibration
  let proposalStats: { total: number; accepted: number; avgConfidenceAccepted: number } | undefined;
  if (db && agentState.sessionId) {
    const stats = db.getProposalStats();
    if (stats.total > 10) {
      proposalStats = { total: stats.total, accepted: stats.accepted, avgConfidenceAccepted: stats.avgConfidenceAccepted };
    }
  }

  const prompt = buildAnalysisPrompt(seq, bestExamples, userInstruction, proposalStats);
  const maxProposals = (ctx.config['max-proposals'] as number) || 10;

  ctx.log.info(`Analyzing timeline (${bank.size} examples, ${seq.videoTracks.reduce((n, t) => n + t.clips.length, 0)} video clips)`);

  const response = await ctx.services.ai.complete(prompt, {
    system: getSystemPrompt(),
    maxTokens: 4096,
    temperature: 0.3,
  });

  const sessionId = agentState.sessionId || 0;
  let proposals = parseResponse(response, sessionId);

  // Limit to max proposals
  proposals = proposals.slice(0, maxProposals);

  // Store in DB
  if (db && agentState.sessionId) {
    for (const p of proposals) {
      p.id = db.insertProposal(agentState.sessionId, p);
      p.sessionId = agentState.sessionId;
    }
  }

  agentState.proposals = proposals;
  agentState.lastAnalysisTime = Date.now();
  agentState.lastTimelineHash = computeTimelineHash(seq);

  return proposals;
}

async function agentLoop(ctx: PluginContext) {
  try {
    // OBSERVE: check if timeline changed
    const seq = await ctx.services.timeline.getActiveSequence();
    if (!seq) return;

    const hash = computeTimelineHash(seq);
    if (hash === agentState.lastTimelineHash) return; // Nothing changed

    agentState.cycleCount++;
    ctx.log.info(`Agent cycle #${agentState.cycleCount}: timeline changed`);

    // DECIDE: analyze
    const proposals = await runAnalysis(ctx);

    if (proposals.length === 0) {
      ctx.log.info('No proposals generated');
      return;
    }

    // ACT based on mode
    const mode = agentState.mode;

    // Push proposals to panel
    ctx.ui.pushToPanel('proposals', proposals.map(p => ({
      id: p.id,
      editType: p.editType,
      description: p.description,
      confidence: p.confidence,
      reasoning: p.reasoning,
      status: p.status,
    })));

    if (mode === 'preview') {
      // Add markers at proposal locations
      for (const p of proposals) {
        const time = p.action.params.splitTime
          || p.action.params.insertTime
          || p.action.params.moveToTime
          || 0;
        if (time > 0) {
          await ctx.services.timeline.addMarker(
            time,
            `Agent: ${p.editType}`,
            p.confidence >= 0.7 ? 'green' : 'yellow',
            p.description,
          );
        }
      }
    }

    if (mode === 'auto') {
      const threshold = (ctx.config.threshold as number) || 0.7;
      for (const p of proposals) {
        if (p.confidence >= threshold) {
          ctx.log.info(`Auto-executing: ${p.description} (confidence=${p.confidence.toFixed(2)})`);
          const freshSeq = await ctx.services.timeline.getActiveSequence();
          if (!freshSeq) break;
          const ok = await executeProposal(ctx, p, freshSeq);
          const newStatus = ok ? 'executed' : 'failed';
          p.status = newStatus;
          if (db) db.updateProposalStatus(p.id, newStatus);

          ctx.ui.pushToPanel('proposal-update', {
            id: p.id,
            status: newStatus,
          });
        }
      }
    }
  } catch (err) {
    ctx.log.error('Agent loop error:', err);
  }
}

export default definePlugin({
  async activate(ctx) {
    db = new AgentDB(ctx.dataDir);
    agentState.mode = (ctx.config.mode as AgentMode) || 'suggest';

    // Listen for accept/reject from panel
    eventSubs.push(ctx.onEvent('plugin:edit-agent:accept', async (data) => {
      const { proposalId } = data as { proposalId: number };
      if (!db) return;

      const proposal = db.getProposalById(proposalId);
      if (!proposal || proposal.status !== 'pending') return;

      const seq = await ctx.services.timeline.getActiveSequence();
      if (!seq) return;

      const ok = await executeProposal(ctx, proposal, seq);
      const newStatus = ok ? 'executed' : 'failed';
      db.updateProposalStatus(proposalId, newStatus);

      // Update in-memory state
      const p = agentState.proposals.find(p => p.id === proposalId);
      if (p) p.status = newStatus;

      ctx.ui.pushToPanel('proposal-update', { id: proposalId, status: newStatus });
      ctx.log.info(`Proposal ${proposalId} ${newStatus}: ${proposal.description}`);
    }));

    eventSubs.push(ctx.onEvent('plugin:edit-agent:reject', (data) => {
      const { proposalId } = data as { proposalId: number };
      if (!db) return;

      db.updateProposalStatus(proposalId, 'rejected');

      const p = agentState.proposals.find(p => p.id === proposalId);
      if (p) p.status = 'rejected';

      ctx.ui.pushToPanel('proposal-update', { id: proposalId, status: 'rejected' });
      ctx.log.info(`Proposal ${proposalId} rejected`);
    }));

    ctx.log.info('Edit Agent activated');
  },

  async deactivate(ctx) {
    if (loopTimer) {
      clearInterval(loopTimer);
      loopTimer = null;
    }
    if (db && agentState.sessionId) {
      const pending = agentState.proposals.filter(p => p.status === 'pending').length;
      const accepted = agentState.proposals.filter(p => p.status === 'executed' || p.status === 'accepted').length;
      const rejected = agentState.proposals.filter(p => p.status === 'rejected').length;
      db.endSession(agentState.sessionId, {
        cycleCount: agentState.cycleCount,
        generated: agentState.proposals.length,
        accepted,
        rejected,
      });
    }
    for (const sub of eventSubs) sub.unsubscribe();
    eventSubs = [];
    db?.close();
    db = null;
    agentState = {
      mode: 'suggest',
      running: false,
      cycleCount: 0,
      lastAnalysisTime: null,
      lastTimelineHash: null,
      proposals: [],
      sessionId: null,
      exampleCount: 0,
    };
    exampleBank = null;
    ctx.log.info('Edit Agent deactivated');
  },

  commands: {
    analyze: async (ctx, args) => {
      const instruction = args?.instruction as string | undefined;

      if (!db) db = new AgentDB(ctx.dataDir);
      if (!agentState.sessionId) {
        const seq = await ctx.services.timeline.getActiveSequence();
        if (!seq) {
          ctx.ui.showToast('No active sequence', 'warning');
          return null;
        }
        agentState.sessionId = db.createSession(seq.sequenceId, seq.name);
      }

      ctx.ui.showProgress('Analyzing timeline...', 0.5);
      const proposals = await runAnalysis(ctx, instruction);
      ctx.ui.hideProgress();

      if (proposals.length === 0) {
        ctx.ui.showToast('No edit suggestions', 'info');
      } else {
        ctx.ui.showToast(`${proposals.length} edit suggestions`, 'success');
      }

      return proposals.map(p => ({
        id: p.id,
        editType: p.editType,
        description: p.description,
        confidence: p.confidence,
        reasoning: p.reasoning,
        status: p.status,
      }));
    },

    'execute-next': async (ctx) => {
      const pending = agentState.proposals.filter(p => p.status === 'pending');
      if (pending.length === 0) {
        ctx.ui.showToast('No pending proposals', 'info');
        return null;
      }

      // Execute highest-confidence pending proposal
      const proposal = pending.sort((a, b) => b.confidence - a.confidence)[0];
      const seq = await ctx.services.timeline.getActiveSequence();
      if (!seq) {
        ctx.ui.showToast('No active sequence', 'warning');
        return null;
      }

      const ok = await executeProposal(ctx, proposal, seq);
      const newStatus = ok ? 'executed' : 'failed';
      proposal.status = newStatus;
      if (db) db.updateProposalStatus(proposal.id, newStatus);

      ctx.ui.pushToPanel('proposal-update', { id: proposal.id, status: newStatus });
      ctx.ui.showToast(`${ok ? 'Executed' : 'Failed'}: ${proposal.description}`, ok ? 'success' : 'error');

      return { id: proposal.id, status: newStatus, description: proposal.description };
    },

    'accept-all': async (ctx) => {
      const pending = agentState.proposals.filter(p => p.status === 'pending');
      let executed = 0;
      let failed = 0;

      for (const proposal of pending) {
        const seq = await ctx.services.timeline.getActiveSequence();
        if (!seq) break;

        const ok = await executeProposal(ctx, proposal, seq);
        const newStatus = ok ? 'executed' : 'failed';
        proposal.status = newStatus;
        if (db) db.updateProposalStatus(proposal.id, newStatus);
        ctx.ui.pushToPanel('proposal-update', { id: proposal.id, status: newStatus });

        if (ok) executed++;
        else failed++;
      }

      ctx.ui.showToast(`Executed ${executed}, failed ${failed}`, executed > 0 ? 'success' : 'warning');
      return { executed, failed };
    },

    'reject-all': async (ctx) => {
      const pending = agentState.proposals.filter(p => p.status === 'pending');
      for (const proposal of pending) {
        proposal.status = 'rejected';
        if (db) db.updateProposalStatus(proposal.id, 'rejected');
        ctx.ui.pushToPanel('proposal-update', { id: proposal.id, status: 'rejected' });
      }

      ctx.ui.showToast(`Rejected ${pending.length} proposals`, 'info');
      return { rejected: pending.length };
    },

    'set-mode': async (ctx, args) => {
      const mode = args?.mode as AgentMode;
      if (!['suggest', 'preview', 'auto'].includes(mode)) {
        ctx.ui.showToast('Invalid mode. Use: suggest, preview, auto', 'error');
        return null;
      }

      agentState.mode = mode;
      ctx.ui.showToast(`Agent mode: ${mode}`, 'success');
      ctx.ui.pushToPanel('mode-change', { mode });
      return { mode };
    },

    'start-agent': async (ctx) => {
      if (agentState.running) {
        ctx.ui.showToast('Agent already running', 'warning');
        return { running: true };
      }

      const seq = await ctx.services.timeline.getActiveSequence();
      if (!seq) {
        ctx.ui.showToast('No active sequence', 'warning');
        return null;
      }

      if (!db) db = new AgentDB(ctx.dataDir);
      agentState.sessionId = db.createSession(seq.sequenceId, seq.name);
      agentState.running = true;
      agentState.cycleCount = 0;
      agentState.proposals = [];

      loopTimer = setInterval(() => agentLoop(ctx), LOOP_INTERVAL);

      ctx.log.info(`Agent started on "${seq.name}" in ${agentState.mode} mode`);
      ctx.ui.showToast(`Agent started (${agentState.mode} mode)`, 'success');

      return { running: true, mode: agentState.mode, sessionId: agentState.sessionId };
    },

    'stop-agent': async (ctx) => {
      if (!agentState.running) {
        ctx.ui.showToast('Agent not running', 'warning');
        return null;
      }

      if (loopTimer) {
        clearInterval(loopTimer);
        loopTimer = null;
      }

      if (db && agentState.sessionId) {
        const accepted = agentState.proposals.filter(p => p.status === 'executed' || p.status === 'accepted').length;
        const rejected = agentState.proposals.filter(p => p.status === 'rejected').length;
        db.endSession(agentState.sessionId, {
          cycleCount: agentState.cycleCount,
          generated: agentState.proposals.length,
          accepted,
          rejected,
        });
      }

      const stats = {
        cycleCount: agentState.cycleCount,
        totalProposals: agentState.proposals.length,
        executed: agentState.proposals.filter(p => p.status === 'executed').length,
        rejected: agentState.proposals.filter(p => p.status === 'rejected').length,
      };

      agentState.running = false;
      agentState.sessionId = null;
      agentState.cycleCount = 0;
      agentState.proposals = [];
      agentState.lastTimelineHash = null;

      ctx.log.info(`Agent stopped. ${stats.cycleCount} cycles, ${stats.totalProposals} proposals`);
      ctx.ui.showToast('Agent stopped', 'info');

      return stats;
    },

    'refresh-patterns': async (ctx) => {
      if (!db) db = new AgentDB(ctx.dataDir);

      // Reload example bank
      const bank = loadExampleBank(getCuttingBoardDataDir(ctx.dataDir));
      agentState.exampleCount = bank.size;
      const distribution = bank.getDistribution();

      // Compute calibration from proposal history
      const calibration = computeCalibration(db);
      const proposalStats = db.getProposalStats();

      // Update threshold if calibration is reliable
      if (calibration.calibrationScore > 0.5) {
        ctx.log.info(`Calibration recommends threshold ${calibration.recommendedThreshold.toFixed(2)} (score=${calibration.calibrationScore.toFixed(2)})`);
      }

      ctx.ui.showToast(`${bank.size} examples loaded, calibration=${calibration.calibrationScore.toFixed(2)}`, 'success');

      return {
        exampleCount: bank.size,
        distribution,
        calibration,
        proposalStats,
      };
    },

    status: async (ctx) => {
      const pending = agentState.proposals.filter(p => p.status === 'pending').length;
      const executed = agentState.proposals.filter(p => p.status === 'executed').length;
      const rejected = agentState.proposals.filter(p => p.status === 'rejected').length;

      return {
        mode: agentState.mode,
        running: agentState.running,
        cycleCount: agentState.cycleCount,
        lastAnalysisTime: agentState.lastAnalysisTime,
        exampleCount: agentState.exampleCount,
        proposals: {
          total: agentState.proposals.length,
          pending,
          executed,
          rejected,
        },
      };
    },
  },
});
