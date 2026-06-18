import { yttsDb, withConnection } from "./db/oracle"
import type { TaxLayoutRow, JavaField, CompareRow } from "@/features/media-layout/types"
import type { HwpField } from "@/features/media-layout/lib/hwp-parser"

// ── 공개 타입 ─────────────────────────────────────────────────

/** MLAY_TAX 행 (편집용 — SEQ 포함) */
export interface TaxRow {
  seq:        number
  recordType: string
  code:       string   // 항목코드 (A1, C5 …)
  item:       string   // 항목명
  val:        string   // 원본 표현 (X(10), 9(13))
  fieldType?: string   // x | 9
  fieldLen?:  number
  hwpCum?:    number   // HWP 문서상 누적값 (계산누적과 다르면 오타 의심)
  gubun?:     string   // 구분 레이블 (예: 【자료관리번호】)
  sect:       string   // HEAD | BODY_N | FOOT
}

export interface HwpFileRow {
  year:        number
  userId:      number
  hwpFileName: string
  rowCount:    number
  uploadedAt:  string  // ISO 문자열
}

export interface JavaFileRow {
  year:         number
  userId:       number
  javaFileName: string
  rowCount:     number
  uploadedAt:   string
}

export interface TaxSectConfigRow {
  year:        number
  userId:      number
  record:      string
  target:      "TAX" | "JAVA"
  sectMode:    "body" | "hbf"
  bodyStart:   number
  bodyEnd:     number
  repeatCount: number
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────

const DATE_FMT = `TO_CHAR(UPLOADED_AT, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS UPLOADED_AT`

function toHwpRow(r: Record<string, unknown>): HwpFileRow {
  return {
    year:        r.YEAR        as number,
    userId:      r.USER_ID     as number,
    hwpFileName: (r.HWP_FILE_NAME as string) ?? "",
    rowCount:    (r.ROW_COUNT   as number)  ?? 0,
    uploadedAt:  (r.UPLOADED_AT as string)  ?? "",
  }
}

function toJavaRow(r: Record<string, unknown>): JavaFileRow {
  return {
    year:         r.YEAR          as number,
    userId:       r.USER_ID       as number,
    javaFileName: (r.JAVA_FILE_NAME as string) ?? "",
    rowCount:     (r.ROW_COUNT     as number)  ?? 0,
    uploadedAt:   (r.UPLOADED_AT   as string)  ?? "",
  }
}

// Oracle 11g: FETCH FIRST 미지원 → ROWNUM 서브쿼리 사용
function firstRow(sql: string): string {
  return `SELECT * FROM (${sql}) WHERE ROWNUM = 1`
}

// ── MLAY_HWP_FILE ─────────────────────────────────────────────

export async function getHwpFile(year: number, userId: number): Promise<HwpFileRow | null> {
  const rows = await yttsDb.query<Record<string, unknown>>(
    firstRow(`SELECT YEAR, USER_ID, HWP_FILE_NAME, ROW_COUNT, ${DATE_FMT}
              FROM MLAY_HWP_FILE WHERE YEAR = :1 AND USER_ID = :2`),
    [year, userId]
  )
  return rows.length ? toHwpRow(rows[0]) : null
}

export async function getLatestHwpFile(userId: number): Promise<HwpFileRow | null> {
  const rows = await yttsDb.query<Record<string, unknown>>(
    firstRow(`SELECT YEAR, USER_ID, HWP_FILE_NAME, ROW_COUNT, ${DATE_FMT}
              FROM MLAY_HWP_FILE WHERE USER_ID = :1 ORDER BY YEAR DESC`),
    [userId]
  )
  return rows.length ? toHwpRow(rows[0]) : null
}

// ── MLAY_JAVA_FILE ────────────────────────────────────────────

export async function getJavaFile(year: number, userId: number): Promise<JavaFileRow | null> {
  const rows = await yttsDb.query<Record<string, unknown>>(
    firstRow(`SELECT YEAR, USER_ID, JAVA_FILE_NAME, ROW_COUNT, ${DATE_FMT}
              FROM MLAY_JAVA_FILE WHERE YEAR = :1 AND USER_ID = :2`),
    [year, userId]
  )
  return rows.length ? toJavaRow(rows[0]) : null
}

// ── HWP 업로드 저장 (트랜잭션) ───────────────────────────────

export async function saveHwpFile(
  userId:   number,
  year:     number,
  fileName: string,
  filePath: string | null,
  hwpData:  Buffer,
  fields:   HwpField[],
): Promise<void> {
  await withConnection("ytts", async (conn) => {
    // 기존 데이터 삭제 (MLAY_TAX CASCADE)
    await conn.execute(
      `DELETE FROM MLAY_HWP_FILE WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId]
    )
    // MLAY_COMPARE는 FK 없으므로 직접 삭제
    await conn.execute(
      `DELETE FROM MLAY_COMPARE WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId]
    )
    // MLAY_SECT_CONFIG (TAX) 삭제
    await conn.execute(
      `DELETE FROM MLAY_SECT_CONFIG WHERE YEAR = :1 AND USER_ID = :2 AND TARGET = 'TAX'`,
      [year, userId]
    )

    // HWP 파일 메타 + 원본 저장
    await conn.execute(
      `INSERT INTO MLAY_HWP_FILE
         (YEAR, USER_ID, HWP_FILE_NAME, HWP_FILE_PATH, HWP_DATA, ROW_COUNT, UPLOADED_AT)
       VALUES (:1, :2, :3, :4, :5, :6, SYSDATE)`,
      [year, userId, fileName, filePath, hwpData, fields.length]
    )

    // 파싱 결과 일괄 삽입
    if (fields.length > 0) {
      await conn.executeMany(
        `INSERT INTO MLAY_TAX
           (YEAR, USER_ID, SEQ, RECORD_TYPE, GUBUN, CODE, ITEM, VAL, FIELD_TYPE, FIELD_LEN, HWP_CUM, SECT)
         VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12)`,
        fields.map((f, i) => [
          year, userId, i + 1,
          f.record,
          f.gubun ?? null,
          f.no,
          f.name || null,
          f.dtype || null,
          f.dtype ? f.dtype[0].toLowerCase() : null,
          f.len   ?? null,
          f.cum   ?? null,
          "body_1",
        ])
      )

      // 레코드 타입별 MLAY_SECT_CONFIG 기본값 삽입
      const records = [...new Set(fields.map(f => f.record))].sort()
      await conn.executeMany(
        `INSERT INTO MLAY_SECT_CONFIG
           (YEAR, USER_ID, RECORD_TYPE, TARGET, SECT_MODE, BODY_START, BODY_END, REPEAT_COUNT)
         VALUES (:1, :2, :3, :4, :5, :6, :7, :8)`,
        records.map(rec => [year, userId, rec, 'TAX', 'body', null, null, null])
      )
    }
  })
}

// ── Java 업로드 저장 (트랜잭션) ──────────────────────────────

export async function saveJavaFile(
  userId:   number,
  year:     number,
  fileName: string,
  filePath: string | null,
  javaText: string,
  fields:   JavaField[],
): Promise<void> {
  await withConnection("ytts", async (conn) => {
    // 기존 데이터 삭제 (MLAY_JAVA CASCADE)
    await conn.execute(
      `DELETE FROM MLAY_JAVA_FILE WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId]
    )
    // MLAY_COMPARE 직접 삭제
    await conn.execute(
      `DELETE FROM MLAY_COMPARE WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId]
    )

    // Java 파일 메타 + 원본 저장
    await conn.execute(
      `INSERT INTO MLAY_JAVA_FILE
         (YEAR, USER_ID, JAVA_FILE_NAME, JAVA_FILE_PATH, JAVA_DATA, ROW_COUNT, UPLOADED_AT)
       VALUES (:1, :2, :3, :4, :5, :6, SYSDATE)`,
      [year, userId, fileName, filePath, javaText, fields.length]
    )

    // 파싱 결과 일괄 삽입
    if (fields.length > 0) {
      await conn.executeMany(
        `INSERT INTO MLAY_JAVA
           (YEAR, USER_ID, SEQ, RECORD_TYPE, CODE, ITEM, FIELD_TYPE, FIELD_LEN, LINE_NO, JAVA_CODE, SECT, BODY_ITER)
         VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12)`,
        fields.map((f, i) => [
          year, userId, i + 1,
          f.record,
          f.no       || null,
          f.name     || null,
          f.dtype    || null,
          f.len      ?? null,
          f.lineNo   ?? 0,
          f.raw      || null,
          f.sect     || null,
          f.bodyIter ?? null,
        ])
      )
    }
  })
}

// ── MLAY_TAX 조회 ─────────────────────────────────────────────

export async function getTaxRows(year: number, userId: number, record?: string): Promise<TaxLayoutRow[]> {
  const [sql, params] = record
    ? [
        `SELECT GUBUN, CODE, ITEM, VAL, FIELD_TYPE, FIELD_LEN, SECT
         FROM MLAY_TAX WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3 ORDER BY SEQ`,
        [year, userId, record],
      ]
    : [
        `SELECT GUBUN, CODE, ITEM, VAL, FIELD_TYPE, FIELD_LEN, SECT
         FROM MLAY_TAX WHERE YEAR = :1 AND USER_ID = :2 ORDER BY SEQ`,
        [year, userId],
      ]
  const rows = await yttsDb.query<Record<string, unknown>>(sql, params)
  return rows.map(r => ({
    구분:  (r.GUBUN      as string) ?? "",
    코드:  (r.CODE       as string) ?? "",
    항목:  (r.ITEM       as string) ?? "",
    값:    (r.VAL        as string) ?? "",
    타입:  (r.FIELD_TYPE as string) || undefined,
    길이:  (r.FIELD_LEN  as number) || undefined,
    sect:  (r.SECT       as string) ?? "body_1",
  }))
}

// ── MLAY_JAVA 조회 ────────────────────────────────────────────

export async function getJavaRows(year: number, userId: number, record?: string): Promise<JavaField[]> {
  const [sql, params] = record
    ? [
        `SELECT RECORD_TYPE, CODE, ITEM, FIELD_TYPE, FIELD_LEN, LINE_NO, JAVA_CODE, SECT, BODY_ITER
         FROM MLAY_JAVA WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3 ORDER BY SEQ`,
        [year, userId, record],
      ]
    : [
        `SELECT RECORD_TYPE, CODE, ITEM, FIELD_TYPE, FIELD_LEN, LINE_NO, JAVA_CODE, SECT, BODY_ITER
         FROM MLAY_JAVA WHERE YEAR = :1 AND USER_ID = :2 ORDER BY SEQ`,
        [year, userId],
      ]
  const rows = await yttsDb.query<Record<string, unknown>>(sql, params)
  return rows.map(r => ({
    record:   (r.RECORD_TYPE as string) ?? "",
    no:       (r.CODE        as string) ?? "",
    name:     (r.ITEM        as string) ?? "",
    dtype:    (r.FIELD_TYPE  as string) ?? "x",
    len:      (r.FIELD_LEN   as number) ?? 0,
    cum:      0,  // 조회 시 윈도우 함수로 계산 (미저장)
    lineNo:   (r.LINE_NO     as number) ?? 0,
    raw:      (r.JAVA_CODE   as string) ?? "",
    sect:     (r.SECT        as string) ?? "body_1",
    bodyIter: (r.BODY_ITER   as number | null) ?? undefined,
  }))
}

// ── MLAY_SECT_CONFIG ─────────────────────────────────────────

export async function getAllTaxSectConfigs(
  year: number, userId: number, target: "TAX" | "JAVA" = "TAX"
): Promise<Record<string, TaxSectConfigRow>> {
  const rows = await yttsDb.query<Record<string, unknown>>(
    `SELECT YEAR, USER_ID, RECORD_TYPE, TARGET, SECT_MODE, BODY_START, BODY_END, REPEAT_COUNT
     FROM MLAY_SECT_CONFIG WHERE YEAR = :1 AND USER_ID = :2 AND TARGET = :3`,
    [year, userId, target]
  )
  const result: Record<string, TaxSectConfigRow> = {}
  for (const r of rows) {
    const rec = r.RECORD_TYPE as string
    result[rec] = {
      year:        r.YEAR         as number,
      userId:      r.USER_ID      as number,
      record:      rec,
      target:      r.TARGET       as "TAX" | "JAVA",
      sectMode:    r.SECT_MODE    as "body" | "hbf",
      bodyStart:   (r.BODY_START  as number) ?? null,
      bodyEnd:     (r.BODY_END    as number) ?? null,
      repeatCount: (r.REPEAT_COUNT as number) ?? null,
    }
  }
  return result
}

export async function getTaxSectConfig(
  year: number, userId: number, record: string, target: "TAX" | "JAVA" = "TAX"
): Promise<TaxSectConfigRow | null> {
  const rows = await yttsDb.query<Record<string, unknown>>(
    `SELECT YEAR, USER_ID, RECORD_TYPE, TARGET, SECT_MODE, BODY_START, BODY_END, REPEAT_COUNT
     FROM MLAY_SECT_CONFIG
     WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3 AND TARGET = :4`,
    [year, userId, record, target]
  )
  if (!rows.length) return null
  const r = rows[0]
  return {
    year:        r.YEAR        as number,
    userId:      r.USER_ID     as number,
    record:      r.RECORD_TYPE as string,
    target:      r.TARGET      as "TAX" | "JAVA",
    sectMode:    r.SECT_MODE   as "body" | "hbf",
    bodyStart:   (r.BODY_START   as number) ?? 1,
    bodyEnd:     (r.BODY_END     as number) ?? 1,
    repeatCount: (r.REPEAT_COUNT as number) ?? 1,
  }
}

export async function saveTaxSectConfig(cfg: TaxSectConfigRow): Promise<void> {
  await withConnection("ytts", async (conn) => {
    await conn.execute(
      `DELETE FROM MLAY_SECT_CONFIG
       WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3 AND TARGET = :4`,
      [cfg.year, cfg.userId, cfg.record, cfg.target]
    )
    await conn.execute(
      `INSERT INTO MLAY_SECT_CONFIG
         (YEAR, USER_ID, RECORD_TYPE, TARGET, SECT_MODE, BODY_START, BODY_END, REPEAT_COUNT)
       VALUES (:1, :2, :3, :4, :5, :6, :7, :8)`,
      [cfg.year, cfg.userId, cfg.record, cfg.target, cfg.sectMode, cfg.bodyStart, cfg.bodyEnd, cfg.repeatCount]
    )
  })
}

// MLAY_SECT_CONFIG + MLAY_TAX.SECT를 단일 트랜잭션으로 저장
export async function saveSectConfigWithRows(
  cfg:      TaxSectConfigRow,
  sectRows: { seq: number; sect: string }[],
): Promise<void> {
  await withConnection("ytts", async (conn) => {
    await conn.execute(
      `DELETE FROM MLAY_SECT_CONFIG
       WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3 AND TARGET = :4`,
      [cfg.year, cfg.userId, cfg.record, cfg.target]
    )
    await conn.execute(
      `INSERT INTO MLAY_SECT_CONFIG
         (YEAR, USER_ID, RECORD_TYPE, TARGET, SECT_MODE, BODY_START, BODY_END, REPEAT_COUNT)
       VALUES (:1, :2, :3, :4, :5, :6, :7, :8)`,
      [cfg.year, cfg.userId, cfg.record, cfg.target, cfg.sectMode, cfg.bodyStart, cfg.bodyEnd, cfg.repeatCount]
    )
    if (sectRows.length > 0) {
      await conn.executeMany(
        `UPDATE MLAY_TAX SET SECT = :1 WHERE YEAR = :2 AND USER_ID = :3 AND SEQ = :4`,
        sectRows.map(r => [r.sect, cfg.year, cfg.userId, r.seq])
      )
    }
  })
}

// ── 비교 데이터 빌드 (순차 1:1 매치) ─────────────────────────

export function buildCompareRows(taxRows: TaxLayoutRow[], javaRows: JavaField[]): CompareRow[] {
  const len = Math.max(taxRows.length, javaRows.length)
  return Array.from({ length: len }, (_, i) => ({
    seq:  i + 1,
    tax:  taxRows[i]  ?? null,
    java: javaRows[i] ?? null,
    cmd:  null,
  }))
}

export function calcSummary(rows: CompareRow[]) {
  let taxBytes = 0, javaBytes = 0, errors = 0
  for (const row of rows) {
    if (row.tax?.길이)  taxBytes  += row.tax.길이
    if (row.java?.len) javaBytes += row.java.len
    if (row.tax && row.java &&
        (row.tax.타입 !== row.java.dtype || row.tax.길이 !== row.java.len)) errors++
  }
  return { taxBytes, javaBytes, errors }
}

// ── MLAY_TAX 전체 조회 (편집용) ──────────────────────────────

export async function getAllTaxRows(year: number, userId: number): Promise<TaxRow[]> {
  const rows = await yttsDb.query<Record<string, unknown>>(
    `SELECT SEQ, RECORD_TYPE, CODE, ITEM, VAL, FIELD_TYPE, FIELD_LEN, HWP_CUM, GUBUN, SECT
     FROM MLAY_TAX WHERE YEAR = :1 AND USER_ID = :2 ORDER BY SEQ`,
    [year, userId]
  )
  return rows.map(r => ({
    seq:        r.SEQ         as number,
    recordType: (r.RECORD_TYPE as string) ?? "",
    code:       (r.CODE        as string) ?? "",
    item:       (r.ITEM        as string) ?? "",
    val:        (r.VAL         as string) ?? "",
    fieldType:  (r.FIELD_TYPE  as string) || undefined,
    fieldLen:   (r.FIELD_LEN   as number) || undefined,
    hwpCum:     (r.HWP_CUM     as number) || undefined,
    gubun:      (r.GUBUN       as string) || undefined,
    sect:       (r.SECT        as string) ?? "body_1",
  }))
}

// ── MLAY_TAX 배치 업데이트 ────────────────────────────────────

export async function updateTaxRows(
  year:    number,
  userId:  number,
  updates: Pick<TaxRow, "seq" | "code" | "item" | "fieldType" | "fieldLen">[],
): Promise<void> {
  if (updates.length === 0) return
  await withConnection("ytts", async (conn) => {
    await conn.executeMany(
      `UPDATE MLAY_TAX
          SET CODE = :1, ITEM = :2, FIELD_TYPE = :3, FIELD_LEN = :4
        WHERE YEAR = :5 AND USER_ID = :6 AND SEQ = :7`,
      updates.map(u => [
        u.code      || null,
        u.item      || null,
        u.fieldType || null,
        u.fieldLen  ?? null,
        year, userId, u.seq,
      ])
    )
  })
}

export async function updateTaxSect(
  year:   number,
  userId: number,
  rows:   { seq: number; sect: string }[],
): Promise<void> {
  if (rows.length === 0) return
  await withConnection("ytts", async (conn) => {
    await conn.executeMany(
      `UPDATE MLAY_TAX SET SECT = :1 WHERE YEAR = :2 AND USER_ID = :3 AND SEQ = :4`,
      rows.map(r => [r.sect, year, userId, r.seq])
    )
  })
}
