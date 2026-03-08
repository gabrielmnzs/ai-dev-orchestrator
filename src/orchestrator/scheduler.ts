import { logger } from '../utils/logger';
import { Orchestrator } from './transitions';

export const startScheduler = (orchestrator: Orchestrator, intervalMinutes: number) => {
  const intervalMs = intervalMinutes * 60 * 1000;

  logger.info('Scheduler started', { intervalMinutes });

  const tick = async () => {
    try {
      await orchestrator.tick();
    } catch (error) {
      logger.error('Scheduler tick failed', { error });
    }
  };

  tick();
  return setInterval(tick, intervalMs);
};
