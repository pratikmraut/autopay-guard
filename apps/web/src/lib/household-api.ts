import {
  ApiClientError,
  type ApiProblem,
  type Commitment,
  type CreatedHouseholdInvitation,
  type Household,
  type HouseholdInvitation,
  type HouseholdInvitationCollection,
  type HouseholdList,
  type HouseholdMember,
  type HouseholdMemberCollection,
  type RequestContext,
} from "@autopay-guard/contracts";

export type HouseholdAccessRole = Household["accessRole"];
export type HouseholdMemberRole = HouseholdMember["role"];
export type HouseholdMemberStatus = HouseholdMember["status"];
export type HouseholdInvitationStatus = HouseholdInvitation["status"];
export type CommitmentVisibility = "PRIVATE" | "HOUSEHOLD";

export type HouseholdAccessDto = Household;
export type HouseholdMemberDto = HouseholdMember;
export type HouseholdInvitationDto = HouseholdInvitation;

export type CreatedHouseholdInvitationDto = Omit<
  CreatedHouseholdInvitation,
  "emailSent"
> & {
  emailSent: false;
};

export type HouseholdCommitmentDto = Omit<
  Commitment,
  "visibility" | "responsibleMemberId" | "canManage" | "dataOwnerUserId"
> & {
  dataOwnerUserId: string;
  responsibleMemberId: string | null;
  visibility: CommitmentVisibility;
  canManage: boolean;
};

export interface UpdateCommitmentSharingBody {
  visibility: CommitmentVisibility;
  responsibleMemberId: string | null;
}

export type HouseholdCollectionDto = HouseholdList;

export type HouseholdMemberCollectionDto = HouseholdMemberCollection;
export type HouseholdInvitationCollectionDto = HouseholdInvitationCollection;

export type PagedRequestContext = RequestContext & {
  cursor?: string;
  limit?: number;
};

export class HouseholdApi {
  private readonly baseUrl: string;
  private readonly fetchApi: typeof globalThis.fetch;

  constructor({
    baseUrl,
    fetchApi = globalThis.fetch.bind(globalThis),
  }: {
    baseUrl: string;
    fetchApi?: typeof globalThis.fetch;
  }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchApi = fetchApi;
  }

  async listHouseholds(
    context: PagedRequestContext = {},
  ): Promise<HouseholdCollectionDto> {
    return this.request(
      collectionPath("/v1/households", context),
      "GET",
      context,
    );
  }

  async listMembers(
    householdId: string,
    context: PagedRequestContext = {},
  ): Promise<HouseholdMemberCollectionDto> {
    return this.request(
      collectionPath(
        `/v1/households/${encodeURIComponent(householdId)}/members`,
        context,
      ),
      "GET",
      context,
    );
  }

  async listHouseholdInvitations(
    householdId: string,
    context: PagedRequestContext = {},
  ): Promise<HouseholdInvitationCollectionDto> {
    return this.request(
      collectionPath(
        `/v1/households/${encodeURIComponent(householdId)}/invitations`,
        context,
      ),
      "GET",
      context,
    );
  }

  async createInvitation(
    householdId: string,
    inviteeEmail: string,
    context: RequestContext = {},
  ): Promise<CreatedHouseholdInvitationDto> {
    return this.request(
      `/v1/households/${encodeURIComponent(householdId)}/invitations`,
      "POST",
      context,
      { inviteeEmail },
    );
  }

  async revokeInvitation(
    householdId: string,
    invitationId: string,
    ifMatch: string,
    context: RequestContext = {},
  ): Promise<void> {
    return this.request(
      `/v1/households/${encodeURIComponent(householdId)}/invitations/${encodeURIComponent(invitationId)}`,
      "DELETE",
      withHeader(context, "if-match", ifMatch),
    );
  }

  async listIncomingInvitations(
    context: PagedRequestContext = {},
  ): Promise<HouseholdInvitationCollectionDto> {
    return this.request(
      collectionPath("/v1/household-invitations", context),
      "GET",
      context,
    );
  }

  async acceptInvitation(
    invitationCode: string,
    idempotencyKey: string,
    context: RequestContext = {},
  ): Promise<HouseholdMemberDto> {
    return this.request(
      "/v1/household-invitations/accept",
      "POST",
      withHeader(context, "idempotency-key", idempotencyKey),
      { invitationCode },
    );
  }

  async removeMember(
    householdId: string,
    memberId: string,
    ifMatch: string,
    context: RequestContext = {},
  ): Promise<void> {
    return this.request(
      `/v1/households/${encodeURIComponent(householdId)}/members/${encodeURIComponent(memberId)}`,
      "DELETE",
      withHeader(context, "if-match", ifMatch),
    );
  }

  async updateCommitmentSharing(
    commitmentId: string,
    ifMatch: string,
    body: UpdateCommitmentSharingBody,
    context: RequestContext = {},
  ): Promise<HouseholdCommitmentDto> {
    return this.request(
      `/v1/commitments/${encodeURIComponent(commitmentId)}/sharing`,
      "PATCH",
      withHeader(context, "if-match", ifMatch),
      body,
    );
  }

  private async request<T>(
    path: string,
    method: string,
    context: RequestContext,
    body?: unknown,
  ): Promise<T> {
    const headers = new Headers({
      accept: "application/json, application/problem+json",
    });
    new Headers(context.headers).forEach((value, name) =>
      headers.set(name, value),
    );
    const init: RequestInit = {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      signal: context.signal,
    };
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(body);
    }

    const response = await this.fetchApi(`${this.baseUrl}${path}`, init);
    if (response.ok) {
      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    }

    const problem = await readProblem(response);
    const correlationId =
      response.headers.get("x-correlation-id") ??
      problem?.correlationId ??
      null;
    throw new ApiClientError(
      problem?.detail ??
        problem?.title ??
        `Request failed with status ${response.status}.`,
      response.status,
      problem,
      correlationId,
    );
  }
}

function collectionPath(path: string, context: PagedRequestContext) {
  const query = new URLSearchParams();
  if (context.limit !== undefined) {
    query.set("limit", String(context.limit));
  }
  if (context.cursor) {
    query.set("cursor", context.cursor);
  }
  return query.size === 0 ? path : `${path}?${query.toString()}`;
}

function withHeader(
  context: RequestContext,
  name: string,
  value: string,
): RequestContext {
  const headers = new Headers(context.headers);
  headers.set(name, value);
  return { ...context, headers };
}

async function readProblem(response: Response): Promise<ApiProblem | null> {
  if (!(response.headers.get("content-type") ?? "").includes("json")) {
    return null;
  }
  try {
    return (await response.json()) as ApiProblem;
  } catch {
    return null;
  }
}
