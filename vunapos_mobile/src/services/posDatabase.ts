import * as SQLite from "expo-sqlite";

export const POS_DATABASE_NAME = "vunapos-cache.db";
export const POS_DATABASE_SCHEMA_VERSION = 2;

/**
 * Version 1 is the cache envelope table used by the existing generic cache.
 * Version 2 adds the normalized read-model tables. Keeping these migrations
 * explicit lets an existing installation upgrade without losing its cache.
 */
export const POS_DATABASE_MIGRATIONS: Readonly<Record<number, string>> = {
  1: `
    CREATE TABLE IF NOT EXISTS pos_cache_entries (
      cache_key TEXT PRIMARY KEY NOT NULL,
      namespace TEXT NOT NULL,
      resource TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      payload TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pos_cache_namespace_accessed
      ON pos_cache_entries(namespace, accessed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pos_cache_namespace_resource
      ON pos_cache_entries(namespace, resource);
    CREATE INDEX IF NOT EXISTS idx_pos_cache_expires_at
      ON pos_cache_entries(expires_at);
  `,
  2: `
    CREATE TABLE IF NOT EXISTS pos_items (
      namespace TEXT NOT NULL,
      item_code TEXT NOT NULL,
      item_name TEXT NOT NULL,
      description TEXT,
      image TEXT,
      stock_uom TEXT,
      sales_uom TEXT,
      has_batch_no INTEGER NOT NULL DEFAULT 0,
      has_serial_no INTEGER NOT NULL DEFAULT 0,
      disabled INTEGER NOT NULL DEFAULT 0,
      modified TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY(namespace, item_code)
    );
    CREATE TABLE IF NOT EXISTS pos_item_barcodes (
      namespace TEXT NOT NULL,
      barcode TEXT NOT NULL,
      item_code TEXT NOT NULL,
      uom TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY(namespace, barcode)
    );
    CREATE TABLE IF NOT EXISTS pos_item_prices (
      namespace TEXT NOT NULL,
      item_code TEXT NOT NULL,
      price_list TEXT NOT NULL,
      uom TEXT NOT NULL DEFAULT '',
      customer TEXT NOT NULL DEFAULT '',
      rate REAL,
      precision INTEGER,
      version TEXT,
      modified TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY(namespace, item_code, price_list, uom, customer)
    );
    CREATE TABLE IF NOT EXISTS pos_inventory (
      namespace TEXT NOT NULL,
      item_code TEXT NOT NULL,
      warehouse TEXT NOT NULL,
      available_qty REAL,
      version INTEGER NOT NULL,
      updated_at TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY(namespace, item_code, warehouse)
    );
    CREATE TABLE IF NOT EXISTS pos_customers (
      namespace TEXT NOT NULL,
      customer TEXT NOT NULL,
      customer_name TEXT,
      modified TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY(namespace, customer)
    );
    CREATE TABLE IF NOT EXISTS pos_tax_templates (
      namespace TEXT NOT NULL,
      template_name TEXT NOT NULL,
      modified TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY(namespace, template_name)
    );
    CREATE TABLE IF NOT EXISTS pos_item_tax_templates (
      namespace TEXT NOT NULL,
      template_name TEXT NOT NULL,
      modified TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY(namespace, template_name)
    );
    CREATE TABLE IF NOT EXISTS pos_configuration (
      namespace TEXT NOT NULL,
      config_key TEXT NOT NULL,
      version TEXT,
      payload TEXT NOT NULL,
      PRIMARY KEY(namespace, config_key)
    );
    CREATE TABLE IF NOT EXISTS pos_sync_state (
      namespace TEXT NOT NULL,
      domain TEXT NOT NULL,
      cursor TEXT,
      last_sync_at TEXT,
      schema_version INTEGER NOT NULL,
      PRIMARY KEY(namespace, domain)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_items_name
      ON pos_items(namespace, item_name);
    CREATE INDEX IF NOT EXISTS idx_pos_items_code
      ON pos_items(namespace, item_code);
    CREATE INDEX IF NOT EXISTS idx_pos_item_barcodes_item
      ON pos_item_barcodes(namespace, item_code);
    CREATE INDEX IF NOT EXISTS idx_pos_item_prices_item_list
      ON pos_item_prices(namespace, item_code, price_list, uom);
    CREATE INDEX IF NOT EXISTS idx_pos_inventory_item_warehouse
      ON pos_inventory(namespace, item_code, warehouse);
    CREATE INDEX IF NOT EXISTS idx_pos_inventory_version
      ON pos_inventory(namespace, warehouse, version);
    CREATE INDEX IF NOT EXISTS idx_pos_customers_name
      ON pos_customers(namespace, customer_name);
    CREATE INDEX IF NOT EXISTS idx_pos_item_tax_templates_name
      ON pos_item_tax_templates(namespace, template_name);
    CREATE INDEX IF NOT EXISTS idx_pos_sync_state_domain
      ON pos_sync_state(namespace, domain);
  `,
};

export function getPosDatabaseMigrationStatements(
  fromVersion: number,
  toVersion: number = POS_DATABASE_SCHEMA_VERSION,
) {
  if (fromVersion < 0 || toVersion < fromVersion || toVersion > POS_DATABASE_SCHEMA_VERSION) {
    throw new Error("Invalid POS database migration range");
  }
  return Array.from({ length: toVersion - fromVersion }, (_, index) => {
    const version = fromVersion + index + 1;
    const migration = POS_DATABASE_MIGRATIONS[version];
    if (!migration) throw new Error(`Missing POS database migration ${version}`);
    return { sql: migration, version };
  });
}

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function openPosDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(POS_DATABASE_NAME)
      .then(async (database) => {
        const version = await database.getFirstAsync<{ user_version: number }>(
          "PRAGMA user_version",
        );
        let currentVersion = version?.user_version ?? 0;
        await database.execAsync("PRAGMA journal_mode = WAL");

        if (currentVersion > POS_DATABASE_SCHEMA_VERSION) {
          await database.withTransactionAsync(async () => {
            await database.execAsync(`
              DROP TABLE IF EXISTS pos_cache_entries;
              DROP TABLE IF EXISTS pos_items;
              DROP TABLE IF EXISTS pos_item_barcodes;
              DROP TABLE IF EXISTS pos_item_prices;
              DROP TABLE IF EXISTS pos_inventory;
              DROP TABLE IF EXISTS pos_customers;
              DROP TABLE IF EXISTS pos_tax_templates;
              DROP TABLE IF EXISTS pos_item_tax_templates;
              DROP TABLE IF EXISTS pos_configuration;
              DROP TABLE IF EXISTS pos_sync_state;
              PRAGMA user_version = 0;
            `);
          });
          currentVersion = 0;
        }

        const migrations = getPosDatabaseMigrationStatements(currentVersion);
        for (const migration of migrations) {
          await database.withTransactionAsync(async () => {
            await database.execAsync(migration.sql);
            await database.execAsync(`PRAGMA user_version = ${migration.version}`);
          });
        }
        return database;
      })
      .catch((error: unknown) => {
        databasePromise = null;
        throw error;
      });
  }
  return databasePromise;
}

/** Used by account/company reset flows and by database migration recovery. */
export async function resetPosDatabase() {
  const database = await openPosDatabase();
  await database.withTransactionAsync(async () => {
    await database.execAsync(`
      DELETE FROM pos_cache_entries;
      DELETE FROM pos_items;
      DELETE FROM pos_item_barcodes;
      DELETE FROM pos_item_prices;
      DELETE FROM pos_inventory;
      DELETE FROM pos_customers;
      DELETE FROM pos_tax_templates;
      DELETE FROM pos_item_tax_templates;
      DELETE FROM pos_configuration;
      DELETE FROM pos_sync_state;
    `);
  });
}
