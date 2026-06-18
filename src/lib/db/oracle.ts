import oracledb from "oracledb"

type PoolAlias = "yts" | "ytts"

// HMR 재실행 시에도 초기화 상태를 유지하기 위해 globalThis 사용
declare global {
  var __oracleClientReady: boolean | undefined
  var __oraclePoolCreating: Map<string, Promise<void>> | undefined
}

function initClient() {
  if (globalThis.__oracleClientReady) return
  const libDir = process.env.ORACLE_CLIENT_PATH
  oracledb.initOracleClient(libDir ? { libDir } : undefined)
  globalThis.__oracleClientReady = true
}

async function initPool(alias: PoolAlias) {
  // 풀이 이미 존재하면 재사용
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try { (oracledb as any).getPool(alias); return } catch { /* 없으면 아래서 생성 */ }

  // 동시 요청 경쟁 조건 방지: 이미 생성 중인 Promise가 있으면 그것을 기다림
  if (globalThis.__oraclePoolCreating?.has(alias)) {
    await globalThis.__oraclePoolCreating.get(alias)
    return
  }

  initClient()

  if (!globalThis.__oraclePoolCreating) globalThis.__oraclePoolCreating = new Map()

  const isYts = alias === "yts"
  const creating = oracledb.createPool({
    poolAlias: alias,
    user:          isYts ? process.env.YTS_DB_USER          : process.env.YTTS_DB_USER,
    password:      isYts ? process.env.YTS_DB_PASSWORD       : process.env.YTTS_DB_PASSWORD,
    connectString: isYts ? process.env.YTS_DB_CONNECT_STRING : process.env.YTTS_DB_CONNECT_STRING,
    poolMin: 1,
    poolMax: 5,
  }).then(() => { globalThis.__oraclePoolCreating?.delete(alias) })
    .catch((err) => { globalThis.__oraclePoolCreating?.delete(alias); throw err })

  globalThis.__oraclePoolCreating.set(alias, creating)
  await creating
}

export async function query<T = Record<string, unknown>>(
  alias: PoolAlias,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  await initPool(alias)
  const conn = await oracledb.getConnection(alias)
  try {
    const result = await conn.execute(sql, params, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    })
    return (result.rows ?? []) as T[]
  } finally {
    await conn.close()
  }
}

export async function execute(
  alias: PoolAlias,
  sql: string,
  params: unknown[] = []
): Promise<{ rowsAffected: number }> {
  await initPool(alias)
  const conn = await oracledb.getConnection(alias)
  try {
    const result = await conn.execute(sql, params, { autoCommit: true })
    return { rowsAffected: result.rowsAffected ?? 0 }
  } finally {
    await conn.close()
  }
}

/** 연말정산시스템 DB */
export const ytsDb = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
    query<T>("yts", sql, params),
  execute: (sql: string, params?: unknown[]) =>
    execute("yts", sql, params),
}

/** 연말정산지원시스템 DB */
export const yttsDb = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
    query<T>("ytts", sql, params),
  execute: (sql: string, params?: unknown[]) =>
    execute("ytts", sql, params),
}

/**
 * 트랜잭션이 필요한 작업에 사용. fn이 완료되면 commit, 예외 시 rollback.
 * fn 내부에서 conn.execute / conn.executeMany 를 직접 호출.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function withConnection<T>(
  alias: PoolAlias,
  fn: (conn: any) => Promise<T>
): Promise<T> {
  await initPool(alias)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = await oracledb.getConnection(alias) as any
  try {
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (err) {
    try { await conn.rollback() } catch { /* ignore rollback error */ }
    throw err
  } finally {
    await conn.close()
  }
}
