package in.autopayguard.api.privacy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

class PrivacyExportBoundsTest {

    @Test
    void sqlLimitsTheDriverResultToOneSentinelBeyondTheCollectionBudget() {
        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(
                "jdbc:h2:mem:export_bounds_" + UUID.randomUUID(), "sa", ""));
        PrivacyExportReadBudget budget = new PrivacyExportReadBudget();
        AtomicInteger materialized = new AtomicInteger();
        String boundedSql = budget.boundedSql("SELECT X FROM SYSTEM_RANGE(1, 10000)");
        assertThat(boundedSql).endsWith("LIMIT 1001");
        assertThat(jdbc.queryForList(boundedSql, Long.class)).hasSize(1001);
        assertThatThrownBy(() -> jdbc.query(boundedSql, (resultSet, rowNumber) -> {
            budget.acceptRow(rowNumber);
            materialized.incrementAndGet();
            return resultSet.getLong(1);
        })).isInstanceOf(PrivacyExportService.ExportTooLargeException.class);
        assertThat(materialized).hasValue(PrivacyExportReadBudget.MAX_COLLECTION_ROWS);
    }

    @Test
    void totalRowsAreBoundedAcrossNestedCollectionsAndNextQueryOnlyFetchesASentinel() {
        PrivacyExportReadBudget budget = new PrivacyExportReadBudget();
        for (int row = 0; row < PrivacyExportReadBudget.MAX_ROWS; row++) {
            budget.acceptRow(row % PrivacyExportReadBudget.MAX_COLLECTION_ROWS);
        }
        assertThat(budget.boundedSql("SELECT id FROM ignored_fixture")).endsWith("LIMIT 1");
        assertThatThrownBy(() -> budget.acceptRow(0))
                .isInstanceOf(PrivacyExportService.ExportTooLargeException.class);
    }

    @Test
    void manySmallQueriesAndTotalRetainedTextHaveSeparateBudgets() {
        PrivacyExportReadBudget budget = new PrivacyExportReadBudget();
        for (int query = 0; query < PrivacyExportReadBudget.MAX_QUERIES; query++) {
            budget.boundedSql("SELECT id FROM ignored_fixture");
        }
        assertThatThrownBy(() -> budget.boundedSql("SELECT id FROM ignored_fixture"))
                .isInstanceOf(PrivacyExportService.ExportTooLargeException.class);
        budget.acceptScalar("x".repeat(PrivacyExportService.MAX_BYTES));
        assertThatThrownBy(() -> budget.acceptScalar("x"))
                .isInstanceOf(PrivacyExportService.ExportTooLargeException.class);
    }

    @Test
    @SuppressWarnings("unchecked")
    void exporterRejectsTheSentinelBeforeReadingOrSerializingItsValues() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ObjectMapper mapper = mock(ObjectMapper.class);
        PrivacyNoticeService notice = mock(PrivacyNoticeService.class);
        ResultSet rows = mock(ResultSet.class);
        ResultSetMetaData metadata = mock(ResultSetMetaData.class);
        when(rows.getMetaData()).thenReturn(metadata);
        when(metadata.getColumnCount()).thenReturn(1);
        when(metadata.getColumnLabel(1)).thenReturn("id");
        AtomicInteger valuesRead = new AtomicInteger();
        when(rows.getObject(1)).thenAnswer(invocation -> {
            valuesRead.incrementAndGet();
            return UUID.randomUUID();
        });
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
                .thenAnswer(invocation -> {
                    assertThat((String) invocation.getArgument(0)).endsWith("LIMIT 1001");
                    RowMapper<Map<String, Object>> rowMapper = invocation.getArgument(1);
                    for (int row = 0; row <= PrivacyExportReadBudget.MAX_COLLECTION_ROWS; row++) {
                        rowMapper.mapRow(rows, row);
                    }
                    throw new AssertionError("The oversized collection must fail before returning.");
                });
        PrivacyExportService service = new PrivacyExportService(jdbc, mapper, notice);
        assertThatThrownBy(() -> service.build(UUID.randomUUID(), Instant.EPOCH))
                .isInstanceOf(PrivacyExportService.ExportTooLargeException.class);
        assertThat(valuesRead).hasValue(PrivacyExportReadBudget.MAX_COLLECTION_ROWS);
        verifyNoInteractions(mapper, notice);
    }

    @Test
    void byteOutputAcceptsExactLimitAndRejectsExcessWithoutRetainingIt() {
        PrivacyExportService.BoundedExportOutput output =
                new PrivacyExportService.BoundedExportOutput(4);
        output.write(new byte[] { 1, 2, 3 }, 0, 3);
        output.write(4);
        assertThat(output.toByteArray()).containsExactly(1, 2, 3, 4);
        assertThatThrownBy(() -> output.write(new byte[] { 5, 6 }, 0, 2))
                .isInstanceOf(PrivacyExportService.ExportTooLargeException.class);
        assertThat(output.exceeded()).isTrue();
        assertThat(output.toByteArray()).containsExactly(1, 2, 3, 4);
    }

    @Test
    void jacksonStopsAtTheUtf8ByteBudgetRatherThanSerializingTheWholeDocument() {
        ObjectMapper mapper = JsonMapper.builder().build();
        PrivacyExportService.BoundedExportOutput output =
                new PrivacyExportService.BoundedExportOutput(128);
        assertThatThrownBy(() -> mapper.writeValue(output, Map.of("content", "₹".repeat(1000))))
                .isInstanceOf(RuntimeException.class);
        assertThat(output.exceeded()).isTrue();
        assertThat(output.toByteArray().length).isLessThanOrEqualTo(128);
    }

    @Test
    void boundedSerializationPreservesOrdinaryCanonicalJsonBytes() {
        ObjectMapper mapper = JsonMapper.builder().build();
        Map<String, Object> fixture = Map.of("amountMinor", 27500, "name", "Demo ₹");
        PrivacyExportService.BoundedExportOutput output =
                new PrivacyExportService.BoundedExportOutput(1024);
        mapper.writeValue(output, fixture);
        assertThat(output.toByteArray()).isEqualTo(mapper.writeValueAsBytes(fixture));
        assertThat(new String(output.toByteArray(), StandardCharsets.UTF_8)).contains("Demo ₹");
    }
}
