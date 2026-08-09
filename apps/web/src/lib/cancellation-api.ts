import {
  FoundationApi,
  type CancellationAttempt as CancellationAttemptContract,
  type CancellationAttemptPage as CancellationAttemptPageContract,
  type CancellationGuide as CancellationGuideContract,
  type CreateCancellationAttemptRequest,
  type CreateCancellationGuideFeedbackRequest,
  type CreateOccurrenceDecisionRequest,
  type DecisionInboxItem as DecisionInboxItemContract,
  type DecisionInboxPage as DecisionInboxPageContract,
  type GetSavingsParameters,
  type GuideStep as GuideStepContract,
  type GuideTrack as GuideTrackContract,
  type ListCancellationAttemptsParameters,
  type ListDecisionInboxParameters,
  type OccurrenceDecision as OccurrenceDecisionContract,
  type RequestContext,
  type SavingsCurrencySummary as SavingsCurrencySummaryContract,
  type SavingsItem as SavingsItemContract,
  type SavingsPage as SavingsPageContract,
  type SavingsStateTotal as SavingsStateTotalContract,
  type UpdateCancellationAttemptRequest,
  type VerifyCancellationAttemptRequest,
} from "@autopay-guard/contracts";

export type OccurrenceDecision = OccurrenceDecisionContract;
export type DecisionInboxItem = DecisionInboxItemContract;
export type DecisionInboxPage = DecisionInboxPageContract;
export type CancellationGuide = CancellationGuideContract;
export type GuideStep = GuideStepContract;
export type GuideTrack = GuideTrackContract;
export type CancellationAttempt = CancellationAttemptContract;
export type CancellationAttemptPage = CancellationAttemptPageContract;
export type SavingsStateTotal = SavingsStateTotalContract;
export type SavingsCurrencySummary = SavingsCurrencySummaryContract;
export type SavingsItem = SavingsItemContract;
export type SavingsPage = SavingsPageContract;

export type DecisionAction = CreateOccurrenceDecisionRequest["decision"];
export type AmountKind = DecisionInboxItem["amountKind"];
export type GuideFreshness = CancellationGuide["freshness"];
export type GuideTrackKind = GuideTrack["track"];
export type GuideStepKind = GuideStep["kind"];
export type AttemptTrackStatus = CancellationAttempt["serviceStatus"];
export type VerificationStatus = CancellationAttempt["verificationStatus"];
export type FeedbackOutcome = CreateCancellationGuideFeedbackRequest["outcome"];
export type SavingsState = SavingsItem["state"];

type ListAttemptsParameters = Omit<
  ListCancellationAttemptsParameters,
  "commitmentId"
>;

export class CancellationApi {
  private readonly api: FoundationApi;

  constructor({
    baseUrl,
    fetchApi = globalThis.fetch.bind(globalThis),
  }: {
    baseUrl: string;
    fetchApi?: typeof globalThis.fetch;
  }) {
    this.api = new FoundationApi({ baseUrl, fetchApi });
  }

  listDecisionInbox(
    parameters: ListDecisionInboxParameters,
    context: RequestContext = {},
  ) {
    return this.api.listDecisionInbox(parameters, context);
  }

  createDecision(
    occurrenceId: string,
    idempotencyKey: string,
    decision: DecisionAction,
    context: RequestContext = {},
  ) {
    return this.api.createOccurrenceDecision(
      { occurrenceId, idempotencyKey },
      { decision },
      context,
    );
  }

  getGuide(commitmentId: string, context: RequestContext = {}) {
    return this.api.getCancellationGuide({ commitmentId }, context);
  }

  listAttempts(
    commitmentId: string,
    parameters: ListAttemptsParameters,
    context: RequestContext = {},
  ) {
    return this.api.listCancellationAttempts(
      { commitmentId, ...parameters },
      context,
    );
  }

  createAttempt(
    commitmentId: string,
    idempotencyKey: string,
    body: CreateCancellationAttemptRequest,
    context: RequestContext = {},
  ) {
    return this.api.createCancellationAttempt(
      { commitmentId, idempotencyKey },
      body,
      context,
    );
  }

  getAttempt(attemptId: string, context: RequestContext = {}) {
    return this.api.getCancellationAttempt({ attemptId }, context);
  }

  updateAttempt(
    attemptId: string,
    ifMatch: string,
    body: UpdateCancellationAttemptRequest,
    context: RequestContext = {},
  ) {
    return this.api.updateCancellationAttempt(
      { attemptId, ifMatch },
      body,
      context,
    );
  }

  verifyAttempt(
    attemptId: string,
    ifMatch: string,
    idempotencyKey: string,
    status: VerifyCancellationAttemptRequest["status"],
    context: RequestContext = {},
  ) {
    return this.api.verifyCancellationAttempt(
      { attemptId, ifMatch, idempotencyKey },
      { status },
      context,
    );
  }

  submitFeedback(
    guideId: string,
    idempotencyKey: string,
    body: CreateCancellationGuideFeedbackRequest,
    context: RequestContext = {},
  ) {
    return this.api.createCancellationGuideFeedback(
      { guideId, idempotencyKey },
      body,
      context,
    );
  }

  getSavings(parameters: GetSavingsParameters, context: RequestContext = {}) {
    return this.api.getSavings(parameters, context);
  }
}
