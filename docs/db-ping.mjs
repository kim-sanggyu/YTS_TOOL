/** DB 연결 체크 — 성공 exit 0 / 실패 exit 1. 네트워크 복구 감시용. */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
try {
  oracledb.initOracleClient({ libDir: ORACLE_LIB })
  const conn = await oracledb.getConnection({ user: "YTS39", password: "Yts391234!", connectString: DB_CONNECT })
  await conn.execute("SELECT 1 FROM DUAL")
  await conn.close()
  console.log("DB OK")
  process.exit(0)
} catch { process.exit(1) }
