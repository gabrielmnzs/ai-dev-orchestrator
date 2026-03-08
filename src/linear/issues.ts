import { LinearClient } from './client';

type TeamResult = {
  teams: { nodes: Array<{ id: string; name: string }> };
};

type ProjectResult = {
  projects: { nodes: Array<{ id: string; name: string }> };
};

type CreateIssueResult = {
  issueCreate: { issue: { id: string; identifier: string } };
};

type UpdateIssueResult = {
  issueUpdate: { issue: { id: string } };
};

type CreateCommentResult = {
  commentCreate: { comment: { id: string } };
};

type IssueResult = {
  issue: { id: string; identifier: string; title: string; description?: string | null };
};

let cachedTeamId: string | null = null;
let cachedProjectId: string | null = null;

const teamQuery = `
  query Teams {
    teams {
      nodes {
        id
        name
      }
    }
  }
`;

const projectQuery = `
  query Projects {
    projects {
      nodes {
        id
        name
      }
    }
  }
`;

const createIssueMutation = `
  mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      issue {
        id
        identifier
      }
    }
  }
`;

const updateIssueMutation = `
  mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      issue {
        id
      }
    }
  }
`;

const createCommentMutation = `
  mutation CreateComment($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      comment {
        id
      }
    }
  }
`;

const getIssueQuery = `
  query Issue($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
    }
  }
`;

export const getTeamId = async (client: LinearClient, teamName: string): Promise<string> => {
  if (cachedTeamId) {
    return cachedTeamId;
  }
  const data = await client.request<TeamResult>(teamQuery);
  const team = data.teams.nodes.find((node) => node.name === teamName);
  if (!team) {
    throw new Error(`Linear team not found: ${teamName}`);
  }
  cachedTeamId = team.id;
  return team.id;
};

export const getProjectId = async (
  client: LinearClient,
  projectName: string
): Promise<string> => {
  if (cachedProjectId) {
    return cachedProjectId;
  }
  const data = await client.request<ProjectResult>(projectQuery);
  const project = data.projects.nodes.find((node) => node.name === projectName);
  if (!project) {
    throw new Error(`Linear project not found: ${projectName}`);
  }
  cachedProjectId = project.id;
  return project.id;
};

export const createIssue = async (params: {
  client: LinearClient;
  teamName: string;
  projectName: string;
  title: string;
  description?: string;
}): Promise<{ id: string; identifier: string }> => {
  const teamId = await getTeamId(params.client, params.teamName);
  const projectId = await getProjectId(params.client, params.projectName);
  const data = await params.client.request<CreateIssueResult>(createIssueMutation, {
    input: {
      teamId,
      projectId,
      title: params.title,
      description: params.description || ''
    }
  });

  return {
    id: data.issueCreate.issue.id,
    identifier: data.issueCreate.issue.identifier
  };
};

export const updateIssueState = async (params: {
  client: LinearClient;
  issueId: string;
  stateName: string;
}): Promise<void> => {
  await params.client.request<UpdateIssueResult>(updateIssueMutation, {
    id: params.issueId,
    input: { stateName: params.stateName }
  });
};

export const createComment = async (params: {
  client: LinearClient;
  issueId: string;
  body: string;
}): Promise<void> => {
  await params.client.request<CreateCommentResult>(createCommentMutation, {
    input: { issueId: params.issueId, body: params.body }
  });
};

export const getIssue = async (params: {
  client: LinearClient;
  issueId: string;
}) => {
  const data = await params.client.request<IssueResult>(getIssueQuery, {
    id: params.issueId
  });
  return data.issue;
};
