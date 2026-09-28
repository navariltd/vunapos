import {
  getPosDatabaseMigrationStatements,
  POS_DATABASE_SCHEMA_VERSION,
  POS_DATABASE_MIGRATIONS,
} from "@/services/posDatabase";

describe("POS database schema", () => {
  it("provides ordered migrations from the legacy cache to normalized read models", () => {
    const migrations = getPosDatabaseMigrationStatements(0);

    expect(POS_DATABASE_SCHEMA_VERSION).toBe(2);
    expect(migrations.map((migration) => migration.version)).toEqual([1, 2]);
    expect(migrations[0]?.sql).toContain("pos_cache_entries");
    expect(migrations[1]?.sql).toContain("pos_items");
    expect(migrations[1]?.sql).toContain("pos_item_prices");
    expect(migrations[1]?.sql).toContain("pos_inventory");
    expect(migrations[1]?.sql).toContain("pos_item_tax_templates");
    expect(migrations[1]?.sql).toContain("pos_sync_state");
  });

  it("upgrades an existing cache without replaying the legacy migration", () => {
    const migrations = getPosDatabaseMigrationStatements(1);

    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.version).toBe(2);
    expect(migrations[0]?.sql).not.toContain("CREATE TABLE IF NOT EXISTS pos_cache_entries");
  });

  it("rejects invalid or incomplete migration ranges", () => {
    expect(() => getPosDatabaseMigrationStatements(-1)).toThrow(
      "Invalid POS database migration range",
    );
    expect(() => getPosDatabaseMigrationStatements(2, 1)).toThrow(
      "Invalid POS database migration range",
    );
    expect(() => getPosDatabaseMigrationStatements(0, POS_DATABASE_SCHEMA_VERSION + 1)).toThrow(
      "Invalid POS database migration range",
    );
    expect(POS_DATABASE_MIGRATIONS[2]).toContain("PRIMARY KEY(namespace, item_code, warehouse)");
  });
});
