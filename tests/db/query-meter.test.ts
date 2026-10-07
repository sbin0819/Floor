import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { countSqlStatements, createQueryMeter } from "./query-meter";

describe("SQL execution-stage meter", () => {
  let client: PGlite;
  let meter: ReturnType<typeof createQueryMeter>;
  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    meter = createQueryMeter(client);
  });
  beforeEach(() => meter.start());
  afterAll(async () => {
    meter.restore();
    await client.close();
  });

  it("counts three awaited reads as three stages", async () => {
    await client.query("select 1");
    await client.query("select 2");
    await client.query("select 3");
    expect(meter.stop()).toEqual({
      stages: 3,
      statements: 3,
      perStage: [1, 1, 1],
    });
  });

  it("releases all three parallel results in one stage", async () => {
    await Promise.all([
      client.query("select 1"),
      client.query("select 2"),
      client.query("select 3"),
    ]);
    expect(meter.stop()).toEqual({ stages: 1, statements: 3, perStage: [3] });
  });

  it("groups two reads dependent on one first read into stage two", async () => {
    const first = await client.query<{ value: number }>("select 1 as value");
    await Promise.all([
      client.query("select $1::integer", [first.rows[0]?.value]),
      client.sql`select ${2}::integer`,
    ]);
    expect(meter.stop()).toEqual({
      stages: 2,
      statements: 3,
      perStage: [1, 2],
    });
  });

  it("collects chained microtasks before yielding and releases failures with successes", async () => {
    const calls = [
      client.query("select 1"),
      Promise.resolve().then(async () => {
        await Promise.resolve();
        return client.query("select 2");
      }),
      client.query("select definitely_missing_column"),
    ];
    const results = await Promise.allSettled(calls);
    expect(results.map(({ status }) => status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
    ]);
    expect(meter.stop()).toEqual({ stages: 1, statements: 3, perStage: [3] });
  });

  it("counts transaction query, sql and exec sequentially, without BEGIN or COMMIT", async () => {
    await client.transaction(async (tx) => {
      await Promise.all([
        tx.query("select 1"),
        tx.sql`select ${2}::integer`,
        tx.exec("select 3; select 4"),
      ]);
    });
    expect(meter.stop()).toEqual({
      stages: 4,
      statements: 4,
      perStage: [1, 1, 1, 1],
    });
  });

  it("counts all statements in exec rather than only its function call", async () => {
    await client.exec(
      "select ';' as value; /* ignored ; */ select $$;$$; select 3;",
    );
    expect(meter.stop()).toEqual({ stages: 1, statements: 3, perStage: [3] });
  });

  it("instruments Drizzle normal and transaction execution at the client layer", async () => {
    const db = drizzle({ client });
    await Promise.all([db.execute(sql`select 1`), db.execute(sql`select 2`)]);
    await db.transaction(async (tx) => {
      await tx.execute(sql`select 3`);
      await tx.execute(sql`select 4`);
    });
    expect(meter.stop()).toEqual({
      stages: 3,
      statements: 4,
      perStage: [2, 1, 1],
    });
  });

  it("excludes setup while stopped and refuses to stop with outstanding work", async () => {
    expect(meter.stop()).toEqual({ stages: 0, statements: 0, perStage: [] });
    await client.exec(
      "create temporary table meter_setup (id integer); insert into meter_setup values (1)",
    );
    meter.start();
    const read = client.query("select id from meter_setup");
    expect(() => meter.stop()).toThrow("Await all database calls");
    await read;
    expect(meter.stop()).toEqual({ stages: 1, statements: 1, perStage: [1] });
  });

  it("does not count SQL fragments inside literals, nested comments or transaction controls", () => {
    expect(
      countSqlStatements(
        `-- ;\n BEGIN; select 'a'';b', E'a\\';b', "a;b"; /* nested /* ; */ ; */ select $tag$;x$tag$; COMMIT;`,
      ),
    ).toBe(2);
    expect(meter.stop()).toEqual({ stages: 0, statements: 0, perStage: [] });
  });
});
