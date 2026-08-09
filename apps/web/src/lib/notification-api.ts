import {
  FoundationApi,
  type ListNotificationsParameters,
  type Notification as NotificationContract,
  type NotificationDiagnostics,
  type NotificationPage,
  type NotificationPreferences,
  type ReminderRuleSet,
  type RequestContext,
  type UpdateNotificationPreferencesRequest,
  type UpdateReminderRuleSetRequest,
} from "@autopay-guard/contracts";

export type NotificationPreferencesDto = NotificationPreferences;
export type ReminderRulesDto = ReminderRuleSet;
export type NotificationDto = NotificationContract;
export type NotificationPageDto = NotificationPage;
export type NotificationDiagnosticsDto = NotificationDiagnostics;
export type NotificationFilter = NonNullable<
  ListNotificationsParameters["filter"]
>;
export type NotificationStatus = NotificationContract["status"];
export type NotificationFailureCategory =
  NotificationContract["failureCategory"];

export class NotificationApi {
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

  getPreferences(context: RequestContext = {}) {
    return this.api.getNotificationPreferences(context);
  }

  putPreferences(
    ifMatch: string,
    body: UpdateNotificationPreferencesRequest,
    context: RequestContext = {},
  ) {
    return this.api.updateNotificationPreferences({ ifMatch }, body, context);
  }

  getHouseholdRules(householdId: string, context: RequestContext = {}) {
    return this.api.getHouseholdReminderRules({ householdId }, context);
  }

  putHouseholdRules(
    householdId: string,
    ifMatch: string,
    body: UpdateReminderRuleSetRequest,
    context: RequestContext = {},
  ) {
    return this.api.updateHouseholdReminderRules(
      { householdId, ifMatch },
      body,
      context,
    );
  }

  getCommitmentRules(commitmentId: string, context: RequestContext = {}) {
    return this.api.getCommitmentReminderRules({ commitmentId }, context);
  }

  putCommitmentRules(
    commitmentId: string,
    ifMatch: string,
    body: UpdateReminderRuleSetRequest,
    context: RequestContext = {},
  ) {
    return this.api.updateCommitmentReminderRules(
      { commitmentId, ifMatch },
      body,
      context,
    );
  }

  listNotifications(
    parameters: ListNotificationsParameters,
    context: RequestContext = {},
  ) {
    return this.api.listNotifications(parameters, context);
  }

  getNotification(notificationId: string, context: RequestContext = {}) {
    return this.api.getNotification({ notificationId }, context);
  }

  patchNotificationRead(
    notificationId: string,
    ifMatch: string,
    read: boolean,
    context: RequestContext = {},
  ) {
    return this.api.updateNotificationReadState(
      { notificationId, ifMatch },
      { read },
      context,
    );
  }

  getDiagnostics(householdId: string, context: RequestContext = {}) {
    return this.api.getNotificationDiagnostics({ householdId }, context);
  }
}
