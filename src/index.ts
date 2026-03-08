import express from 'express';
import type { IncomingMessage } from 'http';
import { loadConfig } from './config';
import { getOctokit } from './github/app-auth';
import { createGitHubWebhookHandler } from './github/webhooks';
import { LinearClient } from './linear/client';
import { createLinearWebhookHandler } from './linear/webhooks';
import { createInitialState, loadState } from './orchestrator/state';
import { Orchestrator } from './orchestrator/transitions';
import { startScheduler } from './orchestrator/scheduler';
import { logger } from './utils/logger';
import { getProjectId, getTeamId } from './linear/issues';

declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

declare module 'http' {
  interface IncomingMessage {
    rawBody?: string;
  }
}

const startServer = async () => {
  const config = loadConfig();
  const octokit = await getOctokit({
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
    installationId: config.githubAppInstallationId
  });

  const linearClient = new LinearClient({ apiKey: config.linearApiKey });
  const initialState = createInitialState({
    senior: config.devSeniorUser,
    junior: config.devJuniorUser,
    orchestrator: config.githubOrchUser,
    schedulerMinutes: config.schedulerMinutes
  });

  const { state, issueNumber } = await loadState({
    octokit,
    repoFullName: config.githubUpstreamRepo,
    issueTitle: config.stateIssueTitle,
    initialState
  });

  const orchestrator = new Orchestrator(state, {
    octokit,
    linearClient,
    repoFullName: config.githubUpstreamRepo,
    orchestratorRepo: config.orchestratorRepo,
    agentWorkflowFile: config.agentWorkflowFile,
    issueNumber,
    linearTeamName: config.linearTeamName,
    linearProjectName: config.linearProjectName,
    linearSeniorUserId: config.linearSeniorUserId,
    linearJuniorUserId: config.linearJuniorUserId
  });

  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      }
    })
  );

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, state: orchestrator.getState().sprint.state });
  });

  app.get('/status', (_req, res) => {
    res.status(200).json(orchestrator.getState());
  });

  app.get('/checks', async (_req, res) => {
    const results = {
      github: {
        upstreamRepo: { ok: false, error: '' as string | null },
        orchestratorRepo: { ok: false, error: '' as string | null },
        workflows: { ok: false, error: '' as string | null }
      },
      linear: {
        team: { ok: false, error: '' as string | null },
        project: { ok: false, error: '' as string | null }
      }
    };

    try {
      await octokit.request('GET /repos/{owner}/{repo}', {
        owner: config.githubUpstreamRepo.split('/')[0],
        repo: config.githubUpstreamRepo.split('/')[1]
      });
      results.github.upstreamRepo.ok = true;
      results.github.upstreamRepo.error = null;
    } catch (error) {
      results.github.upstreamRepo.error = error instanceof Error ? error.message : 'unknown error';
    }

    try {
      await octokit.request('GET /repos/{owner}/{repo}', {
        owner: config.orchestratorRepo.split('/')[0],
        repo: config.orchestratorRepo.split('/')[1]
      });
      results.github.orchestratorRepo.ok = true;
      results.github.orchestratorRepo.error = null;
    } catch (error) {
      results.github.orchestratorRepo.error = error instanceof Error ? error.message : 'unknown error';
    }

    try {
      await octokit.request('GET /repos/{owner}/{repo}/actions/workflows', {
        owner: config.orchestratorRepo.split('/')[0],
        repo: config.orchestratorRepo.split('/')[1]
      });
      results.github.workflows.ok = true;
      results.github.workflows.error = null;
    } catch (error) {
      results.github.workflows.error = error instanceof Error ? error.message : 'unknown error';
    }

    try {
      await getTeamId(linearClient, config.linearTeamName);
      results.linear.team.ok = true;
      results.linear.team.error = null;
    } catch (error) {
      results.linear.team.error = error instanceof Error ? error.message : 'unknown error';
    }

    try {
      await getProjectId(linearClient, config.linearProjectName);
      results.linear.project.ok = true;
      results.linear.project.error = null;
    } catch (error) {
      results.linear.project.error = error instanceof Error ? error.message : 'unknown error';
    }

    const allOk = Object.values(results.github).every((check) => check.ok)
      && Object.values(results.linear).every((check) => check.ok);

    res.status(allOk ? 200 : 500).json({ ok: allOk, results });
  });

  app.post('/webhooks/github', createGitHubWebhookHandler(orchestrator, config.githubWebhookSecret));
  app.post('/webhooks/linear', createLinearWebhookHandler(orchestrator, config.linearWebhookSecret));

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    logger.info(`Server listening on ${port}`);
  });

  startScheduler(orchestrator, config.schedulerMinutes);
};

startServer().catch((error) => {
  logger.error('Failed to start server', { error });
  process.exit(1);
});
