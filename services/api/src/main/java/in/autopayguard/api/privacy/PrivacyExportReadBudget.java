package in.autopayguard.api.privacy;

/** Request-local bounds applied before JDBC materializes export collections. */
final class PrivacyExportReadBudget {
    static final int MAX_ROWS = 10_000;
    static final int MAX_COLLECTION_ROWS = 1_000;
    static final int MAX_QUERIES = 2_000;

    private int remainingRows = MAX_ROWS;
    private int remainingQueries = MAX_QUERIES;
    private int remainingTextCharacters = PrivacyExportService.MAX_BYTES;

    String boundedSql(String sql) {
        if (remainingQueries-- <= 0) {
            throw new PrivacyExportService.ExportTooLargeException();
        }
        // SQL is application-owned. A database-side sentinel limit prevents the
        // PostgreSQL driver from first buffering the full unbounded result set.
        int fetchLimit = Math.min(remainingRows, MAX_COLLECTION_ROWS) + 1;
        return sql.stripTrailing() + "\nLIMIT " + fetchLimit;
    }

    void acceptRow(int collectionIndex) {
        if (collectionIndex >= MAX_COLLECTION_ROWS || remainingRows <= 0) {
            throw new PrivacyExportService.ExportTooLargeException();
        }
        remainingRows--;
    }

    void acceptScalar(Object scalar) {
        if (scalar instanceof String text) {
            if (text.length() > remainingTextCharacters) {
                throw new PrivacyExportService.ExportTooLargeException();
            }
            remainingTextCharacters -= text.length();
        }
    }
}
