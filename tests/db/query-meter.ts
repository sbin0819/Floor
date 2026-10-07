import type {
  PGlite,
  QueryOptions,
  Results,
  Transaction,
} from "@electric-sql/pglite";

export type QueryMeasurement = {
  stages: number;
  statements: number;
  perStage: number[];
};

// 문자열·주석 안의 세미콜론은 SQL 문장을 나누지 않는다.
export function countSqlStatements(sql: string): number {
  const statements: string[] = [];
  let current = "";
  let index = 0;
  while (index < sql.length) {
    const rest = sql.slice(index);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", index + 2);
      index = end < 0 ? sql.length : end + 1;
      current += " ";
      continue;
    }
    if (rest.startsWith("/*")) {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (sql.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else index += 1;
      }
      current += " ";
      continue;
    }
    const dollar = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(rest)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, index + dollar.length);
      current += " value ";
      index = end < 0 ? sql.length : end + dollar.length;
      continue;
    }
    const char = sql[index];
    if (char === "'" || char === '"') {
      const escaped = char === "'" && /(?:^|\W)[eE]$/.test(current);
      current += " value ";
      index += 1;
      while (index < sql.length) {
        if (escaped && sql[index] === "\\") index += 2;
        else if (sql[index] === char) {
          index += 1;
          if (sql[index] === char) index += 1;
          else break;
        } else index += 1;
      }
      continue;
    }
    if (char === ";") {
      statements.push(current);
      current = "";
    } else current += char;
    index += 1;
  }
  statements.push(current);
  return statements.filter(
    (statement) =>
      statement.trim() && !/^(?:BEGIN|COMMIT)\b/i.test(statement.trim()),
  ).length;
}

type PendingQuery = {
  run: () => Promise<unknown>;
  count: number;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

/** PGlite의 직렬 실행 시간이 아닌, 호출 사이의 실제 대기 의존성을 잰다. */
export function createQueryMeter(client: PGlite) {
  const originalQuery = client.query.bind(client);
  const originalExec = client.exec.bind(client);
  const originalTransaction = client.transaction.bind(client);
  let measuring = false;
  let running = 0;
  let pending: PendingQuery[] = [];
  let perStage: number[] = [];

  async function flush() {
    const batch = pending;
    pending = [];
    const count = batch.reduce((sum, query) => sum + query.count, 0);
    if (count > 0) perStage.push(count);
    // 한 문장의 완료가 다음 의존 문장을 먼저 시작시키지 않도록 모두 기다린다.
    const results = await Promise.allSettled(batch.map(({ run }) => run()));
    results.forEach((result, index) => {
      const query = batch[index];
      if (!query) throw new Error("Missing measured query.");
      running -= 1;
      if (result.status === "fulfilled") query.resolve(result.value);
      else query.reject(result.reason);
    });
  }

  function enqueue<T>(run: () => Promise<T>, count: number): Promise<T> {
    if (!measuring) return run();
    running += 1;
    const result = new Promise<unknown>((resolve, reject) => {
      pending.push({ run, count, resolve, reject });
    });
    if (pending.length === 1) setTimeout(() => void flush(), 0);
    return result as Promise<T>;
  }

  function wrapTransaction(transaction: Transaction): Transaction {
    let tail: Promise<unknown> = Promise.resolve();
    function sequential<T>(run: () => Promise<T>, count: number): Promise<T> {
      if (!measuring) return run();
      running += 1;
      const result = tail.then(() => {
        // 한 연결의 트랜잭션 안에서는 Promise.all도 문장별 순서대로 실행된다.
        perStage.push(...Array.from({ length: count }, () => 1));
        return run();
      });
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result.finally(() => {
        running -= 1;
      });
    }
    return {
      query: <T>(sql: string, params?: unknown[], options?: QueryOptions) =>
        sequential(
          () => transaction.query<T>(sql, params, options),
          countSqlStatements(sql),
        ),
      sql: <T>(strings: TemplateStringsArray, ...params: unknown[]) =>
        sequential(
          () => transaction.sql<T>(strings, ...params),
          countSqlStatements(strings.join("$parameter")),
        ),
      exec: (sql: string, options?: QueryOptions) =>
        sequential(
          () => transaction.exec(sql, options),
          countSqlStatements(sql),
        ),
      rollback: transaction.rollback.bind(transaction),
      listen: transaction.listen.bind(transaction),
      get closed() {
        return transaction.closed;
      },
    };
  }

  client.query = <T>(
    sql: string,
    params?: unknown[],
    options?: QueryOptions,
  ): Promise<Results<T>> =>
    enqueue(
      () => originalQuery<T>(sql, params, options),
      countSqlStatements(sql),
    );
  client.exec = (sql, options) =>
    enqueue(() => originalExec(sql, options), countSqlStatements(sql));
  client.transaction = <T>(callback: (tx: Transaction) => Promise<T>) =>
    originalTransaction((tx) => callback(wrapTransaction(tx)));
  // PGlite의 client.sql은 client.query를 호출한다. tx.sql만 별도 경로다.

  function idle() {
    if (running > 0 || pending.length > 0)
      throw new Error("Await all database calls before changing measurement.");
  }
  return {
    start() {
      idle();
      if (measuring) throw new Error("Query measurement is already active.");
      perStage = [];
      measuring = true;
    },
    stop(): QueryMeasurement {
      idle();
      measuring = false;
      return {
        stages: perStage.length,
        statements: perStage.reduce((sum, count) => sum + count, 0),
        perStage: [...perStage],
      };
    },
    restore() {
      idle();
      measuring = false;
      client.query = originalQuery;
      client.exec = originalExec;
      client.transaction = originalTransaction;
    },
  };
}
