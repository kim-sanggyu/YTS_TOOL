import { yttsDb, withConnection } from "./db/oracle"
import type { TaxLayoutRow, JavaField, CompareRow } from "@/features/media-layout/types"
import type { HwpField } from "@/features/media-layout/lib/hwp-parser"

// ── 공개 타입 ─────────────────────────────────────────────────

/** MLAY_JAVA 행 (조회용) */
export interface JavaRow {
  seq:        number
  recordType: string
  code:       string    // 항목코드 (A1, C5 …)
  item:       string    // 항목명
  fieldType?: string    // x | 9
  fieldLen?:  number
  lineNo?:    number    // Java 소스 라인 번호
  javaCode?:  string    // makeStr(...) 원본
  sect:       string    // HEAD | BODY_N | FOOTER
  bodyIter?:  number
}

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
          "header",
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
    // 기존 데이터 삭제 (MLAY_JAVA CASCADE) + 편집 레이어 초기화
    await conn.execute(
      `DELETE FROM MLAY_JAVA_FILE WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId]
    )
    await conn.execute(
      `DELETE FROM MLAY_COMPARE WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId]
    )
    await conn.execute(
      `DELETE FROM MLAY_JAVA_EDIT WHERE YEAR = :1 AND USER_ID = :2`,
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

// ── MLAY_JAVA 전체 조회 ───────────────────────────────────────

export async function getAllJavaRows(year: number, userId: number): Promise<JavaRow[]> {
  const rows = await yttsDb.query<Record<string, unknown>>(
    `SELECT SEQ, RECORD_TYPE, CODE, ITEM, FIELD_TYPE, FIELD_LEN, LINE_NO, JAVA_CODE, SECT, BODY_ITER
     FROM MLAY_JAVA WHERE YEAR = :1 AND USER_ID = :2 ORDER BY SEQ`,
    [year, userId]
  )
  return rows.map(r => ({
    seq:        r.SEQ         as number,
    recordType: (r.RECORD_TYPE as string) ?? "",
    code:       (r.CODE        as string) ?? "",
    item:       (r.ITEM        as string) ?? "",
    fieldType:  (r.FIELD_TYPE  as string) || undefined,
    fieldLen:   (r.FIELD_LEN   as number) || undefined,
    lineNo:     (r.LINE_NO     as number) || undefined,
    javaCode:   (r.JAVA_CODE   as string) || undefined,
    sect:       (r.SECT        as string) ?? "header",
    bodyIter:   (r.BODY_ITER   as number) || undefined,
  }))
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
    sect:  (r.SECT       as string) ?? "header",
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
    cum:      0,
    lineNo:   (r.LINE_NO     as number) ?? 0,
    raw:      (r.JAVA_CODE   as string) ?? "",
    sect:     (r.SECT        as string) ?? "header",
    bodyIter: (r.BODY_ITER   as number | null) ?? undefined,
  }))
}

// ── MLAY_JAVA_EDIT 타입 ───────────────────────────────────────

export interface JavaEditRow {
  editSeq:     number
  cmd:         "D" | "I" | "M"
  lineNo:      number | null   // D/M: MLAY_JAVA 행 참조
  prevLineNo:  number | null   // I: 앞 행의 LINE_NO (0=레코드 맨앞)
  record:      string | null   // I 전용
  javaCode:    string | null   // I/M: makeStr 표현식
  fieldType:   string | null   // I 전용
  fieldLen:    number | null   // I 전용
  bodyIter:    number | null   // D 전용: 삭제 대상 body 반복 회차 (PREV_LINE_NO 재사용)
}

export async function getJavaEdits(year: number, userId: number, record?: string): Promise<JavaEditRow[]> {
  const [sql, params] = record
    ? [
        `SELECT E.EDIT_SEQ, E.CMD, E.LINE_NO, E.PREV_LINE_NO, E.RECORD_TYPE, E.JAVA_CODE, E.FIELD_TYPE, E.FIELD_LEN
         FROM MLAY_JAVA_EDIT E
         WHERE E.YEAR = :1 AND E.USER_ID = :2
           AND (
             (E.CMD = 'I' AND E.RECORD_TYPE = :3)
             OR
             (E.CMD IN ('D', 'M') AND EXISTS (
               SELECT 1 FROM MLAY_JAVA J
               WHERE J.YEAR = :1 AND J.USER_ID = :2
                 AND J.LINE_NO = E.LINE_NO AND J.RECORD_TYPE = :3
             ))
           )
         ORDER BY E.EDIT_SEQ`,
        [year, userId, record],
      ]
    : [
        `SELECT EDIT_SEQ, CMD, LINE_NO, PREV_LINE_NO, RECORD_TYPE, JAVA_CODE, FIELD_TYPE, FIELD_LEN
         FROM MLAY_JAVA_EDIT WHERE YEAR = :1 AND USER_ID = :2 ORDER BY EDIT_SEQ`,
        [year, userId],
      ]
  const rows = await yttsDb.query<Record<string, unknown>>(sql, params)
  return rows.map(r => {
    const cmd = (r.CMD as string) as "D" | "I" | "M"
    return {
      editSeq:    r.EDIT_SEQ    as number,
      cmd,
      lineNo:     cmd === "I" ? null : ((r.LINE_NO as number | null) ?? null),
      prevLineNo: cmd === "I" ? ((r.PREV_LINE_NO as number | null) ?? null) : null,
      record:     (r.RECORD_TYPE  as string | null) ?? null,
      javaCode:   (r.JAVA_CODE    as string | null) ?? null,
      fieldType:  (r.FIELD_TYPE   as string | null) ?? null,
      fieldLen:   (r.FIELD_LEN    as number | null) ?? null,
      // D: PREV_LINE_NO에 bodyIter 저장. I: LINE_NO에 anchor bodyIter 저장
      bodyIter:   cmd === "D" ? ((r.PREV_LINE_NO as number | null) ?? null) :
                  cmd === "I" ? ((r.LINE_NO      as number | null) ?? null) : null,
    }
  })
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

export function buildCompareRows(
  taxRows:  TaxLayoutRow[],
  javaRows: JavaField[],
  edits:    JavaEditRow[] = [],
): CompareRow[] {
  // 편집 인덱스 구성
  // lineNo만으로는 HBF body 반복 행 구분 불가 → bodyIter 복합키 사용
  const dSet  = new Set(edits.filter(e => e.cmd === "D").map(e => `${e.lineNo}_${e.bodyIter ?? ""}`))
  const mMap  = new Map(edits.filter(e => e.cmd === "M").map(e => [e.lineNo!, e]))
  // I 편집: (prevLineNo, bodyIter) 복합키로 그룹 — lineNo non-unique 대응
  const iMap  = new Map<string, JavaEditRow[]>()
  for (const e of edits.filter(e => e.cmd === "I")) {
    const key = `${e.prevLineNo ?? 0}_${e.bodyIter ?? ""}`
    if (!iMap.has(key)) iMap.set(key, [])
    iMap.get(key)!.push(e)
  }

  const result: CompareRow[] = []
  let ti = 0

  // 맨앞(prevLineNo=0) I 삽입 처리 — header 구간이므로 bodyIter 항상 null
  for (const ie of iMap.get("0_") ?? []) {
    result.push({ seq: result.length + 1, tax: taxRows[ti] ?? null, java: null, cmd: "I", editedRaw: ie.javaCode ?? "" })
    ti++
  }

  for (const java of javaRows) {
    if (dSet.has(`${java.lineNo}_${java.bodyIter ?? ""}`)) {
      // D: 국세청 슬롯 없이 D로 표시 (taxIdx 전진 안 함)
      result.push({ seq: result.length + 1, tax: null, java, cmd: "D", editedRaw: java.raw })
    } else {
      const mEdit = mMap.get(java.lineNo)
      result.push({
        seq:       result.length + 1,
        tax:       taxRows[ti] ?? null,
        java,
        cmd:       null,
        editedRaw: mEdit?.javaCode ?? java.raw,
      })
      ti++
    }

    // 이 java 행 뒤에 삽입할 I 편집 처리
    for (const ie of iMap.get(`${java.lineNo}_${java.bodyIter ?? ""}`) ?? []) {
      result.push({ seq: result.length + 1, tax: taxRows[ti] ?? null, java: null, cmd: "I", editedRaw: ie.javaCode ?? "" })
      ti++
    }
  }

  // 남은 국세청 행 (Java 대응 없음)
  while (ti < taxRows.length) {
    result.push({ seq: result.length + 1, tax: taxRows[ti++], java: null, cmd: null })
  }

  return result
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
    sect:       (r.SECT        as string) ?? "header",
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

// CODE 기준 ITEM 업데이트 (비교 화면용)
export async function updateTaxItemsByCode(
  year:    number,
  userId:  number,
  updates: { code: string; item: string }[],
): Promise<void> {
  if (updates.length === 0) return
  await withConnection("ytts", async (conn) => {
    await conn.executeMany(
      `UPDATE MLAY_TAX SET ITEM = :1 WHERE YEAR = :2 AND USER_ID = :3 AND CODE = :4`,
      updates.map(u => [u.item || null, year, userId, u.code])
    )
  })
}

// M 명령: MLAY_JAVA_EDIT에 upsert (MLAY_JAVA 원본 불변)
export async function updateJavaCodeByLineNo(
  year:    number,
  userId:  number,
  updates: { lineNo: number; javaCode: string }[],
): Promise<void> {
  if (updates.length === 0) return
  await withConnection("ytts", async (conn) => {
    // MAX를 한 번만 읽고 로컬 카운터로 증가
    const maxRow = await conn.execute(
      `SELECT NVL(MAX(EDIT_SEQ),0) AS MSEQ FROM MLAY_JAVA_EDIT WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId], { outFormat: 4002 }
    )
    let seq = ((maxRow.rows?.[0] as { MSEQ: number } | undefined)?.MSEQ ?? 0)
    for (const u of updates) {
      const existing = await conn.execute(
        `SELECT EDIT_SEQ FROM MLAY_JAVA_EDIT WHERE YEAR = :1 AND USER_ID = :2 AND CMD = 'M' AND LINE_NO = :3`,
        [year, userId, u.lineNo], { outFormat: 4002 }
      )
      if ((existing.rows?.length ?? 0) > 0) {
        await conn.execute(
          `UPDATE MLAY_JAVA_EDIT SET JAVA_CODE = :1 WHERE YEAR = :2 AND USER_ID = :3 AND CMD = 'M' AND LINE_NO = :4`,
          [u.javaCode || null, year, userId, u.lineNo]
        )
      } else {
        seq++
        await conn.execute(
          `INSERT INTO MLAY_JAVA_EDIT (YEAR, USER_ID, EDIT_SEQ, CMD, LINE_NO, JAVA_CODE)
           VALUES (:1, :2, :3, 'M', :4, :5)`,
          [year, userId, seq, u.lineNo, u.javaCode || null]
        )
      }
    }
  })
}

// D 명령: MLAY_JAVA_EDIT에 D 레코드 삽입 (MLAY_JAVA 원본 불변)
// bodyIter는 PREV_LINE_NO에 저장 — HBF 반복 행 구분용
export async function markJavaDeleted(
  year:    number,
  userId:  number,
  deletes: { lineNo: number; bodyIter?: number | null }[],
): Promise<number> {
  if (deletes.length === 0) return 0
  let inserted = 0
  await withConnection("ytts", async (conn) => {
    const maxRow = await conn.execute(
      `SELECT NVL(MAX(EDIT_SEQ),0) AS MSEQ FROM MLAY_JAVA_EDIT WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId], { outFormat: 4002 }
    )
    let seq = ((maxRow.rows?.[0] as { MSEQ: number } | undefined)?.MSEQ ?? 0)
    for (const del of deletes) {
      const existing = await conn.execute(
        `SELECT EDIT_SEQ FROM MLAY_JAVA_EDIT
         WHERE YEAR = :1 AND USER_ID = :2 AND CMD = 'D' AND LINE_NO = :3
           AND NVL(PREV_LINE_NO, -1) = NVL(:4, -1)`,
        [year, userId, del.lineNo, del.bodyIter ?? null], { outFormat: 4002 }
      )
      if ((existing.rows?.length ?? 0) > 0) continue
      seq++
      await conn.execute(
        `INSERT INTO MLAY_JAVA_EDIT (YEAR, USER_ID, EDIT_SEQ, CMD, LINE_NO, PREV_LINE_NO)
         VALUES (:1, :2, :3, 'D', :4, :5)`,
        [year, userId, seq, del.lineNo, del.bodyIter ?? null]
      )
      inserted++
    }
  })
  return inserted
}

// I 명령: MLAY_JAVA_EDIT에 I 레코드 삽입 (PREV_LINE_NO=anchor lineNo, LINE_NO=anchor bodyIter)
// inserts는 UI 상 역순(뒤→앞)으로 전달 — 같은 anchor 내 EDIT_SEQ 순서 유지
export async function insertJavaRows(
  year:    number,
  userId:  number,
  inserts: { editedRaw: string; record: string; afterLineNo: number; afterBodyIter?: number | null }[],
): Promise<number> {
  if (inserts.length === 0) return 0
  await withConnection("ytts", async (conn) => {
    const maxRow = await conn.execute(
      `SELECT NVL(MAX(EDIT_SEQ),0) AS MSEQ FROM MLAY_JAVA_EDIT WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId], { outFormat: 4002 }
    )
    let seq = ((maxRow.rows?.[0] as { MSEQ: number } | undefined)?.MSEQ ?? 0)
    for (const ins of inserts) {
      seq++
      const m = /^makeStr\s*\(\s*"([xX9])"\s*,\s*(\d+)/.exec(ins.editedRaw)
      await conn.execute(
        `INSERT INTO MLAY_JAVA_EDIT
           (YEAR, USER_ID, EDIT_SEQ, CMD, LINE_NO, PREV_LINE_NO, RECORD_TYPE, JAVA_CODE, FIELD_TYPE, FIELD_LEN)
         VALUES (:1, :2, :3, 'I', :4, :5, :6, :7, :8, :9)`,
        [year, userId, seq,
          ins.afterBodyIter ?? null,
          ins.afterLineNo,
          ins.record,
          ins.editedRaw || null,
          m ? m[1].toLowerCase() : null,
          m ? parseInt(m[2]) : null]
      )
    }
  })
  return inserts.length
}

// ── 원본 Java 소스 텍스트 조회 ───────────────────────────────

export async function getJavaSourceText(year: number, userId: number): Promise<string | null> {
  const rows = await yttsDb.query<Record<string, unknown>>(
    `SELECT JAVA_DATA FROM MLAY_JAVA_FILE WHERE YEAR = :1 AND USER_ID = :2`,
    [year, userId]
  )
  return rows.length ? ((rows[0].JAVA_DATA as string) ?? null) : null
}

// ── 레코드별 편집 초기화 (MLAY_JAVA_EDIT 삭제) ───────────────

export async function resetJavaEdits(year: number, userId: number, record: string): Promise<number> {
  let deleted = 0
  await withConnection("ytts", async (conn) => {
    const result = await conn.execute(
      `DELETE FROM MLAY_JAVA_EDIT
       WHERE YEAR = :1 AND USER_ID = :2
         AND (
           (CMD = 'I' AND RECORD_TYPE = :3)
           OR
           (CMD IN ('D', 'M') AND LINE_NO IN (
             SELECT LINE_NO FROM MLAY_JAVA
             WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3
           ))
         )`,
      [year, userId, record]
    )
    deleted = (result.rowsAffected ?? 0) as number
  })
  return deleted
}

// ── 바이트 합계 (레코드별) — 요약 화면용 ─────────────────────

export async function getMediaSummary(year: number, userId: number): Promise<{
  hwpFile:     HwpFileRow | null
  javaFile:    JavaFileRow | null
  taxBytes:    Record<string, number>
  javaBytes:   Record<string, number>
  sectConfigs: Record<string, TaxSectConfigRow>
}> {
  const [hwpFile, javaFile, taxAgg, javaAgg, sectConfigs] = await Promise.all([
    getLatestHwpFile(userId).then(f => f?.year === year ? f : getHwpFile(year, userId)),
    getJavaFile(year, userId),
    yttsDb.query<Record<string, unknown>>(
      `SELECT RECORD_TYPE, SUM(NVL(FIELD_LEN,0)) AS BYTES FROM MLAY_TAX WHERE YEAR = :1 AND USER_ID = :2 GROUP BY RECORD_TYPE`,
      [year, userId]
    ),
    yttsDb.query<Record<string, unknown>>(
      `SELECT RECORD_TYPE, SUM(NVL(FIELD_LEN,0)) AS BYTES FROM MLAY_JAVA WHERE YEAR = :1 AND USER_ID = :2 GROUP BY RECORD_TYPE`,
      [year, userId]
    ),
    getAllTaxSectConfigs(year, userId, "TAX"),
  ])
  const taxBytes: Record<string, number> = {}
  for (const r of taxAgg)  taxBytes[r.RECORD_TYPE  as string] = (r.BYTES  as number) ?? 0
  const javaBytes: Record<string, number> = {}
  for (const r of javaAgg) javaBytes[r.RECORD_TYPE as string] = (r.BYTES  as number) ?? 0
  return { hwpFile, javaFile, taxBytes, javaBytes, sectConfigs }
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
