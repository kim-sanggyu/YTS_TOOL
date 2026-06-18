declare module "oracledb" {
  const OUT_FORMAT_OBJECT: number

  interface PoolAttributes {
    poolAlias?: string
    user?: string
    password?: string
    connectString?: string
    poolMin?: number
    poolMax?: number
  }

  interface ExecuteOptions {
    outFormat?: number
    autoCommit?: boolean
  }

  interface Result<T> {
    rows?: T[]
    rowsAffected?: number
  }

  interface Connection {
    execute<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
      options?: ExecuteOptions
    ): Promise<Result<T>>
    close(): Promise<void>
  }

  function initOracleClient(options?: { libDir?: string }): void
  function createPool(attrs: PoolAttributes): Promise<void>
  function getConnection(poolAlias?: string): Promise<Connection>

  export { OUT_FORMAT_OBJECT, initOracleClient, createPool, getConnection }
  export type { Connection, Result, PoolAttributes, ExecuteOptions }
}
