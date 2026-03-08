import { logger } from '../utils/logger';

type LinearClientConfig = {
  apiKey: string;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export class LinearClient {
  private apiKey: string;

  constructor(config: LinearClientConfig) {
    this.apiKey = config.apiKey;
  }

  async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error('Linear API request failed', { status: response.status, text });
      throw new Error('Linear API request failed');
    }

    const payload = (await response.json()) as GraphQLResponse<T>;
    if (payload.errors && payload.errors.length > 0) {
      logger.error('Linear API error', { errors: payload.errors });
      throw new Error(payload.errors[0].message);
    }

    if (!payload.data) {
      throw new Error('Linear API returned no data');
    }

    return payload.data;
  }
}
