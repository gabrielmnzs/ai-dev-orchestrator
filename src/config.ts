type Config = {
  githubAppId: string;
  githubAppPrivateKey: string;
  githubAppInstallationId: string;
  githubUpstreamRepo: string;
  orchestratorRepo: string;
  agentWorkflowFile: string;
  githubOrchUser: string;
  devSeniorUser: string;
  devJuniorUser: string;
  linearApiKey: string;
  linearTeamName: string;
  linearProjectName: string;
  linearSeniorUserId?: string;
  linearJuniorUserId?: string;
  stateIssueTitle: string;
  githubWebhookSecret?: string;
  linearWebhookSecret?: string;
  schedulerMinutes: number;
};

const getRequiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env var: ${key}`);
  }
  return value;
};

const getOptionalEnv = (key: string): string | undefined => {
  const value = process.env[key];
  return value || undefined;
};

export const loadConfig = (): Config => {
  const schedulerMinutes = Number(process.env.SCHEDULER_MINUTES || 10);
  if (Number.isNaN(schedulerMinutes) || schedulerMinutes <= 0) {
    throw new Error('Invalid SCHEDULER_MINUTES');
  }

  return {
    githubAppId: getRequiredEnv('GITHUB_APP_ID'),
    githubAppPrivateKey: getRequiredEnv('GITHUB_APP_PRIVATE_KEY'),
    githubAppInstallationId: getRequiredEnv('GITHUB_APP_INSTALLATION_ID'),
    githubUpstreamRepo: getRequiredEnv('GITHUB_UPSTREAM_REPO'),
    orchestratorRepo: getRequiredEnv('ORCHESTRATOR_REPO'),
    agentWorkflowFile: getOptionalEnv('AGENT_WORKFLOW_FILE') || 'ai-dev-agent.yml',
    githubOrchUser: getRequiredEnv('GITHUB_ORCH_USER'),
    devSeniorUser: getRequiredEnv('DEV_SENIOR_USER'),
    devJuniorUser: getRequiredEnv('DEV_JUNIOR_USER'),
    linearApiKey: getRequiredEnv('LINEAR_API_KEY'),
    linearTeamName: getRequiredEnv('LINEAR_TEAM_NAME'),
    linearProjectName: getRequiredEnv('LINEAR_PROJECT_NAME'),
    linearSeniorUserId: getOptionalEnv('LINEAR_SENIOR_USER_ID'),
    linearJuniorUserId: getOptionalEnv('LINEAR_JUNIOR_USER_ID'),
    stateIssueTitle: getRequiredEnv('STATE_ISSUE_TITLE'),
    githubWebhookSecret: getOptionalEnv('GITHUB_WEBHOOK_SECRET'),
    linearWebhookSecret: getOptionalEnv('LINEAR_WEBHOOK_SECRET'),
    schedulerMinutes
  };
};
