// Trusted validator: input is SQL and bound values, never customer JavaScript.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const configuration = JSON.parse(
  fs.readFileSync(path.join(__dirname, "check-input.json"), "utf8"),
);
const result = { kind: "sqlite", passed: false, checks: [] };
const normalize = (value) => {
  if (typeof value === "bigint")
    return value <= BigInt(Number.MAX_SAFE_INTEGER) &&
      value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  if (value instanceof Uint8Array)
    return { base64: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalize(v)]),
    );
  return value;
};
const describe = (error) => ({
  code: error.code || error.name,
  sqlite_code: error.errcode ?? null,
  message: String(error.message).slice(0, 1000),
});
// SQLite's native VFS can block on inaccessible Windows paths. This validator
// needs one fresh workspace database, so reject other database/file targets
// before calling the native engine. Quoted values and SQL comments stay data.
function checkedSql(sql, single = false) {
  const words = [];
  let statements = 0,
    hasWord = false;
  for (let i = 0; i < sql.length; ) {
    const ch = sql[i];
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i + 2);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const quote = ch === "[" ? "]" : ch;
      hasWord = true;
      i++;
      while (i < sql.length) {
        if (sql[i++] === quote) {
          if (ch !== "[" && sql[i] === quote) i++;
          else break;
        }
      }
      continue;
    }
    if (ch === ";") {
      if (hasWord) statements++;
      hasWord = false;
      i++;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z_0-9]*/.exec(sql.slice(i));
    if (word) {
      words.push(word[0].toUpperCase());
      hasWord = true;
      i += word[0].length;
    } else {
      if (!/\s/.test(ch)) hasWord = true;
      i++;
    }
  }
  if (hasWord) statements++;
  if (
    words.some((word) =>
      [
        "ATTACH",
        "DETACH",
        "VACUUM",
        "PRAGMA",
        "TEMP_STORE_DIRECTORY",
        "DATA_STORE_DIRECTORY",
      ].includes(word),
    )
  )
    throw Object.assign(
      new Error(
        "Database/file attachment and external file targets are disabled in this SQLite check",
      ),
      { code: "SQLITE_IO_POLICY" },
    );
  if (single && statements !== 1)
    throw Object.assign(
      new Error("Each database check must contain one SQL statement"),
      { code: "SQLITE_STATEMENT_POLICY" },
    );
  return sql;
}
let db;
try {
  fs.mkdirSync(configuration.output_directory);
  // SQLite's Windows VFS still applies MAX_PATH to a relative database name.
  // Use an absolute extended path for this exact trusted workspace target;
  // customer SQL never supplies or changes the database location.
  db = new DatabaseSync(
    path.toNamespacedPath(path.resolve(configuration.output_directory, "database.sqlite")),
    { allowExtension: false },
  );
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(checkedSql(fs.readFileSync(process.argv[2], "utf8")));
  for (const check of configuration.checks) {
    const row = { name: check.name, passed: false, expected: check.expect };
    try {
      db.exec("PRAGMA foreign_keys=ON;");
      if (db.prepare("PRAGMA foreign_keys").get().foreign_keys !== 1)
        throw new Error("Foreign key enforcement could not be enabled");
      const statement = db.prepare(checkedSql(check.sql, true));
      statement.setReadBigInts(true);
      const params = check.params.map((value) =>
        typeof value === "boolean" ? Number(value) : value,
      );
      if (check.expect.rows !== undefined) {
        const rows = [];
        for (const value of statement.iterate(...params)) {
          if (rows.length >= 100) throw new Error("RESULT_ROW_LIMIT");
          rows.push(normalize(value));
        }
        row.actual = { rows };
      } else row.actual = normalize(statement.run(...params));
      if (check.expect.error_code !== undefined)
        throw new Error(
          "Expected a database error but the statement succeeded",
        );
      for (const [key, value] of Object.entries(check.expect))
        assert.deepEqual(row.actual[key], value);
      row.passed = true;
    } catch (error) {
      if (
        check.expect.error_code !== undefined &&
        (error.code === check.expect.error_code ||
          String(error.errcode) === check.expect.error_code) &&
        (!check.expect.error_message ||
          String(error.message).includes(check.expect.error_message))
      ) {
        row.actual = { error: describe(error) };
        row.passed = true;
      } else {
        row.error = String(error.message).slice(0, 1500);
        row.actual ??= { error: describe(error) };
      }
    }
    result.checks.push(row);
  }
  result.passed =
    result.checks.length === configuration.checks.length &&
    result.checks.every((row) => row.passed);
} catch (error) {
  result.error = String(error.message).slice(0, 1500);
} finally {
  if (db) db.close();
  fs.writeFileSync(
    path.join(configuration.output_directory, "results.json"),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
