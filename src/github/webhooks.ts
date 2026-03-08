import { Request, Response } from 'express';
import { verifySignature } from '../utils/verify-signature';
import { logger } from '../utils/logger';
import { Orchestrator } from '../orchestrator/transitions';

export const createGitHubWebhookHandler = (orchestrator: Orchestrator, secret?: string) => {
  return async (req: Request, res: Response) => {
    const payload = req.body as Record<string, unknown>;
    const rawBody = req.rawBody as string | undefined;
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const event = req.headers['x-github-event'] as string | undefined;

    if (secret && rawBody) {
      const valid = verifySignature(secret, rawBody, signature, 'sha256');
      if (!valid) {
        logger.warn('Invalid GitHub webhook signature');
        res.status(401).send('invalid signature');
        return;
      }
    }

    if (!event) {
      res.status(400).send('missing event');
      return;
    }

    await orchestrator.handleGitHubEvent(event, payload);
    res.status(200).send('ok');
  };
};
