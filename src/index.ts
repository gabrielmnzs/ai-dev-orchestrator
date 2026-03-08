import express from 'express';
import { loadConfig } from './config';
import { getOctokit } from './github/app-auth';
import { createGitHubWebhookHandler } from './github/webhooks';
import { LinearClient } from './linear/client';
import { createLinearWebhookHandler } from './linear/webhooks';
import { createInitialState, loadState } from './orchestrator/state';
import { Orchestrator } from './orchestrator/transitions';
import { startScheduler } from './orchestrator/scheduler';
import { logger } from './utils/logger';

declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
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
    issueNumber,
    linearTeamName: config.linearTeamName,
    linearProjectName: config.linearProjectName
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

  app.post('/webhooks/github', createGitHubWebhookHandler(orchestrator, config.webhookSecret));
  app.post('/webhooks/linear', createLinearWebhookHandler(orchestrator, config.webhookSecret));

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
