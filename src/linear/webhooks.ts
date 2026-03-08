import { Request, Response } from 'express';
import { verifySignature } from '../utils/verify-signature';
import { logger } from '../utils/logger';
import { Orchestrator } from '../orchestrator/transitions';

export const createLinearWebhookHandler = (orchestrator: Orchestrator, secret?: string) => {
  return async (req: Request, res: Response) => {
    const payload = req.body as Record<string, unknown>;
    const rawBody = req.rawBody as string | undefined;
    const signature = req.headers['linear-signature'] as string | undefined;

    if (secret && rawBody) {
      const valid = verifySignature(secret, rawBody, signature, 'sha256');
      if (!valid) {
        logger.warn('Invalid Linear webhook signature');
        res.status(401).send('invalid signature');
        return;
      }
    }

    await orchestrator.handleLinearEvent(payload);
    res.status(200).send('ok');
  };
};
