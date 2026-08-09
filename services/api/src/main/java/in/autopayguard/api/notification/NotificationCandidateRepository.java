package in.autopayguard.api.notification;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class NotificationCandidateRepository {

    private static final String KEYSET_PREDICATE =
            """
              AND (
                    (o.scheduled_date - r.offset_days),
                    r.local_send_time,
                    c.id,
                    r.channel,
                    r.offset_days,
                    o.id,
                    r.id
                  ) > (
                    :cursorDate,
                    :cursorTime,
                    :cursorCommitmentId,
                    :cursorChannel,
                    :cursorOffsetDays,
                    :cursorOccurrenceId,
                    :cursorRuleId
                  )
            """;

    private static final String DUE_CANDIDATES =
            """
            SELECT
                h.owner_user_id AS recipient_user_id,
                h.id AS household_id,
                h.timezone AS household_timezone,
                c.id AS commitment_id,
                o.id AS occurrence_id,
                o.scheduled_date,
                r.id AS reminder_rule_id,
                r.channel,
                r.offset_days,
                r.local_send_time,
                p.timezone AS preference_timezone,
                p.quiet_hours_enabled,
                p.quiet_start,
                p.quiet_end,
                p.enabled_at,
                p.in_app_enabled_at,
                p.email_enabled_at,
                ers.activated_at AS rule_set_activated_at,
                CASE
                    WHEN crs.mode = 'INHERIT' THEN crs.activated_at
                    ELSE NULL
                END AS override_activated_at,
                r.activated_at AS rule_activated_at,
                c.updated_at AS commitment_updated_at,
                o.created_at AS occurrence_created_at
            FROM commitment_occurrences o
            JOIN recurring_commitments c
              ON c.id = o.commitment_id
            JOIN households h
              ON h.id = c.household_id
            JOIN notification_preferences p
              ON p.user_id = h.owner_user_id
            LEFT JOIN reminder_rule_sets crs
              ON crs.household_id = h.id
             AND crs.scope_type = 'COMMITMENT'
             AND crs.commitment_id = c.id
            LEFT JOIN reminder_rule_sets hrs
              ON hrs.household_id = h.id
             AND hrs.scope_type = 'HOUSEHOLD'
            JOIN reminder_rule_sets ers
              ON ers.id = CASE
                    WHEN crs.mode = 'CUSTOM' THEN crs.id
                    WHEN crs.mode = 'DISABLED' THEN NULL
                    WHEN hrs.mode = 'CUSTOM' THEN hrs.id
                    ELSE NULL
                 END
            JOIN reminder_rules r
              ON r.rule_set_id = ers.id
             AND r.enabled = TRUE
            LEFT JOIN notifications existing
              ON existing.recipient_user_id = h.owner_user_id
             AND existing.household_id = h.id
             AND existing.commitment_id = c.id
             AND existing.scheduled_date = o.scheduled_date
             AND existing.channel = r.channel
             AND existing.offset_days = r.offset_days
            WHERE c.status = 'ACTIVE'
              AND o.state = 'UPCOMING'
              AND p.enabled = TRUE
              AND (
                    (r.channel = 'IN_APP' AND p.in_app_enabled = TRUE)
                    OR
                    (r.channel = 'EMAIL' AND p.email_enabled = TRUE)
              )
              AND (o.scheduled_date - r.offset_days) BETWEEN :fromDate AND :toDate
              AND existing.id IS NULL
            %s
            ORDER BY
                (o.scheduled_date - r.offset_days) ASC,
                r.local_send_time ASC,
                c.id ASC,
                r.channel ASC,
                r.offset_days ASC,
                o.id ASC,
                r.id ASC
            LIMIT :limit
            FOR UPDATE OF c, o SKIP LOCKED
            """;

    private final NamedParameterJdbcTemplate jdbc;

    NotificationCandidateRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    List<NotificationCandidate> lockDueCandidates(
            LocalDate fromDate,
            LocalDate toDate,
            int limit,
            CandidateCursor cursor) {
        Map<String, Object> parameters = new HashMap<>();
        parameters.put("fromDate", fromDate);
        parameters.put("toDate", toDate);
        parameters.put("limit", limit);
        if (cursor != null) {
            parameters.put("cursorDate", cursor.reminderDate());
            parameters.put("cursorTime", cursor.localSendTime());
            parameters.put(
                    "cursorCommitmentId", cursor.commitmentId());
            parameters.put("cursorChannel", cursor.channel());
            parameters.put(
                    "cursorOffsetDays", cursor.offsetDays());
            parameters.put(
                    "cursorOccurrenceId", cursor.occurrenceId());
            parameters.put("cursorRuleId", cursor.ruleId());
        }
        return jdbc.query(
                DUE_CANDIDATES.formatted(
                        cursor == null ? "" : KEYSET_PREDICATE),
                parameters,
                NotificationCandidateRepository::candidate);
    }

    private static NotificationCandidate candidate(ResultSet row, int ignored)
            throws SQLException {
        NotificationChannel channel =
                NotificationChannel.valueOf(row.getString("channel"));
        return new NotificationCandidate(
                row.getObject("recipient_user_id", UUID.class),
                row.getObject("household_id", UUID.class),
                ZoneId.of(row.getString("household_timezone")),
                row.getObject("commitment_id", UUID.class),
                row.getObject("occurrence_id", UUID.class),
                row.getObject("scheduled_date", LocalDate.class),
                row.getObject("reminder_rule_id", UUID.class),
                channel,
                row.getInt("offset_days"),
                row.getObject("local_send_time", LocalTime.class),
                ZoneId.of(row.getString("preference_timezone")),
                row.getBoolean("quiet_hours_enabled"),
                row.getObject("quiet_start", LocalTime.class),
                row.getObject("quiet_end", LocalTime.class),
                instant(row, "enabled_at"),
                instant(
                        row,
                        channel == NotificationChannel.IN_APP
                                ? "in_app_enabled_at"
                                : "email_enabled_at"),
                instant(row, "rule_set_activated_at"),
                instant(row, "override_activated_at"),
                instant(row, "rule_activated_at"),
                instant(row, "commitment_updated_at"),
                instant(row, "occurrence_created_at"));
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    record NotificationCandidate(
            UUID recipientUserId,
            UUID householdId,
            ZoneId householdTimezone,
            UUID commitmentId,
            UUID occurrenceId,
            LocalDate scheduledDate,
            UUID reminderRuleId,
            NotificationChannel channel,
            int offsetDays,
            LocalTime localSendTime,
            ZoneId preferenceTimezone,
            boolean quietHoursEnabled,
            LocalTime quietStart,
            LocalTime quietEnd,
            Instant preferenceEnabledAt,
            Instant channelEnabledAt,
            Instant ruleSetActivatedAt,
            Instant overrideActivatedAt,
            Instant ruleActivatedAt,
            Instant commitmentUpdatedAt,
            Instant occurrenceCreatedAt) {

        Instant activatedAt() {
            Instant latest = preferenceEnabledAt;
            for (Instant candidate :
                    new Instant[] {
                        channelEnabledAt,
                        ruleSetActivatedAt,
                        ruleActivatedAt,
                        overrideActivatedAt,
                        commitmentUpdatedAt,
                        occurrenceCreatedAt
                    }) {
                if (candidate != null && (latest == null || candidate.isAfter(latest))) {
                    latest = candidate;
                }
            }
            return latest;
        }

        ReminderTimePolicy.QuietHours quietHours() {
            return new ReminderTimePolicy.QuietHours(
                    quietHoursEnabled,
                    quietStart,
                    quietEnd,
                    preferenceTimezone);
        }

        CandidateCursor cursor() {
            return new CandidateCursor(
                    scheduledDate.minusDays(offsetDays),
                    localSendTime,
                    commitmentId,
                    channel.name(),
                    offsetDays,
                    occurrenceId,
                    reminderRuleId);
        }
    }

    record CandidateCursor(
            LocalDate reminderDate,
            LocalTime localSendTime,
            UUID commitmentId,
            String channel,
            int offsetDays,
            UUID occurrenceId,
            UUID ruleId) {}
}
