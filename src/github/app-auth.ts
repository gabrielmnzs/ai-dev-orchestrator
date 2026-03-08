import { Octokit } from '@octokit/core';
import { createAppAuth } from '@octokit/auth-app';

type AuthConfig = {
  appId: string;
  privateKey: string;
  installationId: string;
};

const normalizePrivateKey = (value: string): string => {
  if (value.includes('-----BEGIN')) {
    return value;
  }
  return value.replace(/\\n/g, '\n');
};

export const getOctokit = async (config: AuthConfig): Promise<Octokit> => {
  const auth = createAppAuth({
    appId: config.appId,
    privateKey: normalizePrivateKey(config.privateKey),
    installationId: config.installationId
  });

  const installationAuthentication = await auth({ type: 'installation' });
  return new Octokit({ auth: installationAuthentication.token });
};
