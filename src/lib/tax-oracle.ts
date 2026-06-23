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
  code:       string    // NVL(E.CODE, T.CODE)
  item:       string    // NVL(E.ITEM, T.ITEM)
  원본코드?:  string    // MLAY_TAX_EDIT로 덮어쓴 경우의 원본 MLAY_TAX.CODE
  원본항목?:  string    // MLAY_TAX_EDIT로 덮어쓴 경우의 원본 MLAY_TAX.ITEM
  val:        string    // 원본 표현 (X(10), 9(13))
  fieldType?: string    // x | 9
  fieldLen?:  number
  hwpCum?:    number    // HWP 문서상 누적값 (계산누적과 다르면 오타 의심)
  gubun?:     string    // 구분 레이블 (예: 【자료관리번호】)
  sect:       string    // HEAD | BODY_N | FOOT
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

export interface ItemNoteRow {
  year:       number
  userId:     number
  recordType: string
  code:       string
  memo:       string
  isDone:     boolean
  color:      string   // yellow | red | blue | green
  createdAt:  string
  updatedAt:  string
}

export interface TaxSectConfigRow {
  year:        number
  userId:      number
  record:      string
  target:      "TAX" | "JAVA"
  sectMode:    "body" | "hbf"
  bodyStart:   number | null
  bodyEnd:     number | null
  repeatCount: number | null
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
  userId:    number,
  year:      number,
  fileName:  string,
  filePath:  string | null,
  hwpData:   Buffer,
  fields:    HwpField[],
  parseLogs: { recordType: string; code: string; origText: string; cleanText: string }[] = [],
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
    // MAP 삭제 — Tax SEQ가 바뀌므로 기존 MAP은 무효
    await conn.execute(
      `DELETE FROM MLAY_TAX_JAVA_MAP WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId]
    )
    // 사용자 삽입 Java 행(LINE_NO=0) 삭제 — HWP 재업로드 시 정합성 초기화
    await conn.execute(
      `DELETE FROM MLAY_JAVA WHERE YEAR = :1 AND USER_ID = :2 AND LINE_NO = 0`,
      [year, userId]
    )
    // MLAY_SECT_CONFIG (TAX) 삭제
    await conn.execute(
      `DELETE FROM MLAY_SECT_CONFIG WHERE YEAR = :1 AND USER_ID = :2 AND TARGET = 'TAX'`,
      [year, userId]
    )

    // 파싱 변환 로그 삭제 (재업로드 시 초기화)
    await conn.execute(
      `DELETE FROM MLAY_HWP_PARSE_LOG WHERE YEAR = :1 AND USER_ID = :2`,
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

    // 파싱 변환 로그 저장
    if (parseLogs.length > 0) {
      await conn.executeMany(
        `INSERT INTO MLAY_HWP_PARSE_LOG (YEAR, USER_ID, LOG_SEQ, RECORD_TYPE, CODE, ORIG_TEXT, CLEAN_TEXT)
         VALUES (:1, :2, :3, :4, :5, :6, :7)`,
        parseLogs.map((l, i) => [year, userId, i + 1, l.recordType, l.code, l.origText.slice(0, 2000), (l.cleanText || null)?.slice(0, 2000)])
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
    // 기존 데이터 삭제 (MLAY_JAVA CASCADE) + 편집·MAP 레이어 초기화
    await conn.execute(
      `DELETE FROM MLAY_JAVA_FILE WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId]
    )
    await conn.execute(
      `DELETE FROM MLAY_COMPARE WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId]
    )
    await conn.execute(
      `DELETE FROM MLAY_JAVA_CODE_EDIT WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId]
    )
    await conn.execute(
      `DELETE FROM MLAY_TAX_JAVA_MAP WHERE YEAR = :1 AND USER_ID = :2`,
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
     FROM MLAY_JAVA WHERE YEAR = :1 AND USER_ID = :2 AND LINE_NO != 0 ORDER BY SEQ`,
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
  const mapper = (r: Record<string, unknown>, hasEdit: boolean) => ({
    seq:      r.SEQ        as number,
    구분:    (r.GUBUN      as string) ?? "",
    코드:    (r.CODE       as string) ?? "",
    항목:    (r.ITEM       as string) ?? "",
    원본코드: hasEdit ? ((r.ORG_CODE as string) || undefined) : undefined,
    원본항목: hasEdit ? ((r.ORG_ITEM as string) || undefined) : undefined,
    값:      (r.VAL        as string) ?? "",
    타입:    (r.FIELD_TYPE as string) || undefined,
    길이:    (r.FIELD_LEN  as number) || undefined,
    sect:    (r.SECT       as string) ?? "header",
  })

  const joinSql = (filter: string) =>
    `SELECT T.SEQ, T.GUBUN,
            NVL(CE.CODE, T.CODE) AS CODE,
            NVL(IE.ITEM, T.ITEM) AS ITEM,
            CASE WHEN CE.ORG_CODE IS NOT NULL AND NVL(CE.CODE,'') != NVL(T.CODE,'') THEN T.CODE END AS ORG_CODE,
            CASE WHEN IE.ORG_ITEM IS NOT NULL AND NVL(IE.ITEM,'') != NVL(T.ITEM,'') THEN T.ITEM END AS ORG_ITEM,
            T.VAL, T.FIELD_TYPE, T.FIELD_LEN, T.SECT
     FROM MLAY_TAX T
     LEFT JOIN MLAY_TAX_CODE_EDIT CE ON CE.YEAR = T.YEAR AND CE.USER_ID = T.USER_ID AND CE.RECORD_TYPE = T.RECORD_TYPE AND CE.ORG_CODE = T.CODE
     LEFT JOIN MLAY_TAX_ITEM_EDIT IE ON IE.YEAR = T.YEAR AND IE.USER_ID = T.USER_ID AND IE.RECORD_TYPE = T.RECORD_TYPE AND IE.ORG_ITEM = T.ITEM
     WHERE ${filter} ORDER BY T.SEQ`

  const plainSql = (filter: string) =>
    `SELECT SEQ, GUBUN, CODE, NULL AS ORG_CODE, ITEM, NULL AS ORG_ITEM, VAL, FIELD_TYPE, FIELD_LEN, SECT
     FROM MLAY_TAX WHERE ${filter} ORDER BY SEQ`

  const [joinFilter, plainFilter, params] = record
    ? ["T.YEAR = :1 AND T.USER_ID = :2 AND T.RECORD_TYPE = :3",
       "YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3",
       [year, userId, record]]
    : ["T.YEAR = :1 AND T.USER_ID = :2",
       "YEAR = :1 AND USER_ID = :2",
       [year, userId]]

  try {
    const rows = await yttsDb.query<Record<string, unknown>>(joinSql(joinFilter), params)
    return rows.map(r => mapper(r, true))
  } catch (err: unknown) {
    const oraErr = err as { errorNum?: number; message?: string }
    if (oraErr?.errorNum !== 942) console.error("[getTaxRows] JOIN 오류:", oraErr?.message ?? err)
    else console.warn("[getTaxRows] MLAY_TAX_CODE/ITEM_EDIT 없음 — DDL 실행 필요")
    const rows = await yttsDb.query<Record<string, unknown>>(plainSql(plainFilter), params)
    return rows.map(r => mapper(r, false))
  }
}

// ── MLAY_JAVA 조회 ────────────────────────────────────────────

export async function getJavaRows(year: number, userId: number, record?: string): Promise<JavaField[]> {
  const [sql, params] = record
    ? [
        `SELECT SEQ, RECORD_TYPE, CODE, ITEM, FIELD_TYPE, FIELD_LEN, LINE_NO, JAVA_CODE, SECT, BODY_ITER
         FROM MLAY_JAVA WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3 ORDER BY SEQ`,
        [year, userId, record],
      ]
    : [
        `SELECT SEQ, RECORD_TYPE, CODE, ITEM, FIELD_TYPE, FIELD_LEN, LINE_NO, JAVA_CODE, SECT, BODY_ITER
         FROM MLAY_JAVA WHERE YEAR = :1 AND USER_ID = :2 ORDER BY SEQ`,
        [year, userId],
      ]
  const rows = await yttsDb.query<Record<string, unknown>>(sql, params)
  return rows.map(r => ({
    seq:      (r.SEQ          as number) ?? 0,
    record:   (r.RECORD_TYPE  as string) ?? "",
    no:       (r.CODE         as string) ?? "",
    name:     (r.ITEM         as string) ?? "",
    dtype:    (r.FIELD_TYPE   as string) ?? "x",
    len:      (r.FIELD_LEN    as number) ?? 0,
    cum:      0,
    lineNo:   (r.LINE_NO      as number) ?? 0,
    raw:      (r.JAVA_CODE    as string) ?? "",
    sect:     (r.SECT         as string) ?? "header",
    bodyIter: (r.BODY_ITER    as number | null) ?? undefined,
  }))
}

// ── MLAY_JAVA_CODE_EDIT ───────────────────────────────────────
// M 편집만 저장. MLAY_TAX_CODE_EDIT / MLAY_TAX_ITEM_EDIT 와 동일한 구조.

export interface JavaCodeEdit {
  seq:      number   // MLAY_JAVA.SEQ
  javaCode: string   // 수정된 makeStr 표현식
}

export async function getJavaCodeEdits(year: number, userId: number, record?: string): Promise<JavaCodeEdit[]> {
  const [sql, params] = record
    ? [
        `SELECT E.SEQ, E.JAVA_CODE
         FROM MLAY_JAVA_CODE_EDIT E
         JOIN MLAY_JAVA J ON J.YEAR = :1 AND J.USER_ID = :2 AND J.SEQ = E.SEQ
         WHERE E.YEAR = :3 AND E.USER_ID = :4 AND J.RECORD_TYPE = :5`,
        [year, userId, year, userId, record],
      ]
    : [
        `SELECT SEQ, JAVA_CODE FROM MLAY_JAVA_CODE_EDIT WHERE YEAR = :1 AND USER_ID = :2`,
        [year, userId],
      ]
  const rows = await yttsDb.query<Record<string, unknown>>(sql, params)
  return rows.map(r => ({
    seq:      r.SEQ       as number,
    javaCode: (r.JAVA_CODE as string) ?? "",
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


// ── MLAY_TAX_JAVA_MAP ─────────────────────────────────────────
// seq 기반 HWP ↔ Java 행 매칭 테이블.
// 저장 시 레코드 전체를 DELETE + INSERT batch로 교체 (밀기 방식 SORT_ORDER).

export interface MapSaveRow {
  sortOrder:  number
  recordType: string
  taxSeq:     number | null   // null = Tax 행 없음(overflow 등). D 여부는 rowType='D'로만 구분
  javaSeq:    number | null   // null = I (새 Java 삽입 필요)
  editedRaw?: string | null   // I 행의 makeStr 표현식
  rowType?:   'D' | 'O' | null // D: Java삭제, O: overflow(I밀림), null: 정상/I
}


export async function saveMap(
  year: number, userId: number, record: string, rows: MapSaveRow[]
): Promise<number> {
  await withConnection("ytts", async (conn) => {
    // 기존 I 삽입 행(LINE_NO=0) 삭제 — 이번 저장으로 재생성됨
    await conn.execute(
      `DELETE FROM MLAY_JAVA WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3 AND LINE_NO = 0`,
      [year, userId, record]
    )

    // I 행(javaSeq=null, editedRaw 있음): MLAY_JAVA에 새 행 삽입 후 SEQ 획득
    const maxRow = await conn.execute(
      `SELECT NVL(MAX(SEQ), 0) AS MSEQ FROM MLAY_JAVA WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId], { outFormat: 4002 }
    )
    let javaSeqN = ((maxRow.rows?.[0] as { MSEQ: number } | undefined)?.MSEQ ?? 0)

    const finalRows: MapSaveRow[] = []
    for (const r of rows) {
      if (r.javaSeq === null && r.editedRaw) {
        javaSeqN++
        const parsed = /^makeStr\s*\(\s*"([xX9])"\s*,\s*(\d+)/.exec(r.editedRaw)
        await conn.execute(
          `INSERT INTO MLAY_JAVA
             (YEAR, USER_ID, SEQ, RECORD_TYPE, JAVA_CODE, FIELD_TYPE, FIELD_LEN, LINE_NO)
           VALUES (:1, :2, :3, :4, :5, :6, :7, 0)`,
          [year, userId, javaSeqN, r.recordType, r.editedRaw,
           parsed?.[1]?.toLowerCase() ?? null,
           parsed ? parseInt(parsed[2]) : null]
        )
        finalRows.push({ ...r, javaSeq: javaSeqN })
      } else {
        finalRows.push(r)
      }
    }

    // MAP 교체
    await conn.execute(
      `DELETE FROM MLAY_TAX_JAVA_MAP WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3`,
      [year, userId, record]
    )
    if (finalRows.length > 0) {
      await conn.executeMany(
        `INSERT INTO MLAY_TAX_JAVA_MAP (YEAR, USER_ID, SORT_ORDER, RECORD_TYPE, TAX_SEQ, JAVA_SEQ, ROW_TYPE)
         VALUES (:1, :2, :3, :4, :5, :6, :7)`,
        finalRows.map(r => [year, userId, r.sortOrder, r.recordType, r.taxSeq, r.javaSeq, r.rowType ?? null])
      )
    }
  })
  return rows.length
}

export async function resetMap(year: number, userId: number, record?: string): Promise<number> {
  let deleted = 0
  await withConnection("ytts", async (conn) => {
    const res = record
      ? await conn.execute(
          `DELETE FROM MLAY_TAX_JAVA_MAP WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3`,
          [year, userId, record]
        )
      : await conn.execute(
          `DELETE FROM MLAY_TAX_JAVA_MAP WHERE YEAR = :1 AND USER_ID = :2`,
          [year, userId]
        )
    deleted = (res.rowsAffected ?? 0) as number
  })
  return deleted
}

// MAP 기반 CompareRow 빌드.
// 비교검증 화면은 HWP·Java 둘 다 있을 때만 열리므로 MAP이 항상 존재함을 전제로 한다.
// MAP이 없으면(= 데이터 없음) null 반환.
export async function buildCompareRowsFromMap(
  year: number, userId: number, record: string,
  taxRows: TaxLayoutRow[], javaRows: JavaField[], edits: JavaCodeEdit[],
): Promise<CompareRow[] | null> {
  const mapResult = await yttsDb.query<Record<string, unknown>>(
    `SELECT SORT_ORDER, TAX_SEQ, JAVA_SEQ, ROW_TYPE FROM MLAY_TAX_JAVA_MAP
     WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3
     ORDER BY SORT_ORDER`,
    [year, userId, record]
  )

  if (mapResult.length === 0) return null

  const taxBySeq  = new Map(taxRows.map(r => [r.seq, r]))
  const javaBySeq = new Map(javaRows.map(r => [r.seq, r]))
  // M 편집: MLAY_JAVA.SEQ 기반 (LINE_NO=0 삽입 행은 M 편집 대상 아님)
  const mMap      = new Map(edits.filter(e => e.seq > 0).map(e => [e.seq, e]))

  return mapResult.map((m, i) => {
    const taxSeq  = m.TAX_SEQ  as number | null
    const javaSeq = m.JAVA_SEQ as number | null
    const rowType = (m.ROW_TYPE as 'D' | 'O' | null) ?? null

    // ROW_TYPE='D' → Java 삭제 (사용자 D클릭)
    // ROW_TYPE='O' → overflow (I 삽입으로 Tax 범위 밖으로 밀린 행, D 아님)
    const isD        = rowType === 'D'
    const isOverflow = rowType === 'O'

    const tax = isOverflow
      ? ({ seq: 0, 구분: '', 코드: '', 항목: '', 값: '', sect: '' } as TaxLayoutRow)
      : taxSeq ? (taxBySeq.get(taxSeq) ?? null)
      : null

    const java  = javaSeq ? (javaBySeq.get(javaSeq) ?? null) : null
    const mEdit = java ? mMap.get(java.seq) : null

    // javaSeq 있으나 javaBySeq에 없음 → 저장된 I-행 (LINE_NO=0, getJavaRows 제외)
    const cmd = isD       ? "D"
      : isOverflow        ? null
      : (javaSeq !== null && java === null) ? "I"
      : java?.lineNo === 0 ? "I"
      : null

    return {
      seq: i + 1,
      tax,
      java,
      cmd: cmd as CompareRow["cmd"],
      editedRaw: mEdit?.javaCode ?? java?.raw ?? "",
    }
  })
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
  const mapper = (r: Record<string, unknown>) => ({
    seq:       r.SEQ         as number,
    recordType:(r.RECORD_TYPE as string) ?? "",
    code:      (r.CODE        as string) ?? "",
    item:      (r.ITEM        as string) ?? "",
    원본코드:  (r.ORG_CODE    as string) || undefined,
    원본항목:  (r.ORG_ITEM    as string) || undefined,
    val:       (r.VAL         as string) ?? "",
    fieldType: (r.FIELD_TYPE  as string) || undefined,
    fieldLen:  (r.FIELD_LEN   as number) || undefined,
    hwpCum:    (r.HWP_CUM     as number) || undefined,
    gubun:     (r.GUBUN       as string) || undefined,
    sect:      (r.SECT        as string) ?? "header",
  })

  try {
    const rows = await yttsDb.query<Record<string, unknown>>(
      `SELECT T.SEQ, T.RECORD_TYPE, T.GUBUN,
              NVL(CE.CODE, T.CODE) AS CODE,
              NVL(IE.ITEM, T.ITEM) AS ITEM,
              CASE WHEN CE.ORG_CODE IS NOT NULL AND NVL(CE.CODE,'') != NVL(T.CODE,'') THEN T.CODE END AS ORG_CODE,
              CASE WHEN IE.ORG_ITEM IS NOT NULL AND NVL(IE.ITEM,'') != NVL(T.ITEM,'') THEN T.ITEM END AS ORG_ITEM,
              T.VAL, T.FIELD_TYPE, T.FIELD_LEN, T.HWP_CUM, T.SECT
       FROM MLAY_TAX T
       LEFT JOIN MLAY_TAX_CODE_EDIT CE ON CE.YEAR = T.YEAR AND CE.USER_ID = T.USER_ID AND CE.RECORD_TYPE = T.RECORD_TYPE AND CE.ORG_CODE = T.CODE
       LEFT JOIN MLAY_TAX_ITEM_EDIT IE ON IE.YEAR = T.YEAR AND IE.USER_ID = T.USER_ID AND IE.RECORD_TYPE = T.RECORD_TYPE AND IE.ORG_ITEM = T.ITEM
       WHERE T.YEAR = :1 AND T.USER_ID = :2 ORDER BY T.SEQ`,
      [year, userId]
    )
    return rows.map(mapper)
  } catch (err: unknown) {
    const oraErr = err as { errorNum?: number; message?: string }
    if (oraErr?.errorNum !== 942) console.error("[getAllTaxRows] JOIN 오류:", oraErr?.message ?? err)
    else console.warn("[getAllTaxRows] MLAY_TAX_CODE/ITEM_EDIT 없음 — DDL 실행 필요")
    const rows = await yttsDb.query<Record<string, unknown>>(
      `SELECT SEQ, RECORD_TYPE, GUBUN, CODE, NULL AS ORG_CODE, ITEM, NULL AS ORG_ITEM,
              VAL, FIELD_TYPE, FIELD_LEN, HWP_CUM, SECT
       FROM MLAY_TAX WHERE YEAR = :1 AND USER_ID = :2 ORDER BY SEQ`,
      [year, userId]
    )
    return rows.map(mapper)
  }
}

// ── MLAY_TAX 배치 업데이트 ────────────────────────────────────

export async function updateTaxRows(
  year:    number,
  userId:  number,
  updates: Pick<TaxRow, "seq" | "recordType" | "code" | "item" | "fieldType" | "fieldLen" | "원본코드" | "원본항목">[],
): Promise<void> {
  if (updates.length === 0) return
  await withConnection("ytts", async (conn) => {
    await conn.executeMany(
      `UPDATE MLAY_TAX SET FIELD_TYPE = :1, FIELD_LEN = :2 WHERE YEAR = :3 AND USER_ID = :4 AND SEQ = :5`,
      updates.map(u => [u.fieldType || null, u.fieldLen ?? null, year, userId, u.seq])
    )
    const editUpdates = updates.filter(u => u.recordType)
    if (editUpdates.length > 0)
      await upsertTaxEdit(year, userId, editUpdates.map(u => ({
        recordType: u.recordType,
        orgCode:    u.원본코드 ?? u.code,
        code:       u.code,
        orgItem:    u.원본항목 ?? u.item,
        item:       u.item,
      })), conn)
  })
}

// ORG_ITEM / ORG_CODE 기반 MLAY_TAX_EDIT upsert
// HWP 재업로드 시 SEQ가 재발번되어도 원본 항목명·코드로 편집 이력을 재활용
export async function upsertTaxEdit(
  year:   number,
  userId: number,
  edits:  { recordType: string; orgCode?: string; code?: string; orgItem?: string; item?: string }[],
  conn?:  any,
): Promise<void> {
  if (edits.length === 0) return
  const codeEdits = edits.filter(e => e.orgCode !== undefined && e.code !== undefined)
  const itemEdits = edits.filter(e => e.orgItem !== undefined && e.item !== undefined)
  console.log("[upsertTaxEdit] itemEdits:", JSON.stringify(itemEdits), "codeEdits:", JSON.stringify(codeEdits))

  const run = async (c: any) => {
    for (const e of codeEdits) {
      await c.execute(
        `MERGE INTO MLAY_TAX_CODE_EDIT CE USING DUAL
         ON (CE.YEAR = :1 AND CE.USER_ID = :2 AND CE.RECORD_TYPE = :3 AND CE.ORG_CODE = :4)
         WHEN MATCHED THEN UPDATE SET CE.CODE = :5, CE.EDIT_AT = SYSDATE
         WHEN NOT MATCHED THEN INSERT (YEAR, USER_ID, RECORD_TYPE, ORG_CODE, CODE)
                               VALUES (:1,   :2,      :3,          :4,       :5)`,
        [year, userId, e.recordType, e.orgCode, e.code || null]
      )
      await c.execute(
        `DELETE FROM MLAY_TAX_CODE_EDIT
         WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3 AND ORG_CODE = :4
           AND NVL(CODE,'') = NVL(ORG_CODE,'')`,
        [year, userId, e.recordType, e.orgCode]
      )
    }
    for (const e of itemEdits) {
      await c.execute(
        `MERGE INTO MLAY_TAX_ITEM_EDIT IE USING DUAL
         ON (IE.YEAR = :1 AND IE.USER_ID = :2 AND IE.RECORD_TYPE = :3 AND IE.ORG_ITEM = :4)
         WHEN MATCHED THEN UPDATE SET IE.ITEM = :5, IE.EDIT_AT = SYSDATE
         WHEN NOT MATCHED THEN INSERT (YEAR, USER_ID, RECORD_TYPE, ORG_ITEM, ITEM)
                               VALUES (:1,   :2,      :3,          :4,       :5)`,
        [year, userId, e.recordType, e.orgItem, e.item || null]
      )
      await c.execute(
        `DELETE FROM MLAY_TAX_ITEM_EDIT
         WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3 AND ORG_ITEM = :4
           AND NVL(ITEM,'') = NVL(ORG_ITEM,'')`,
        [year, userId, e.recordType, e.orgItem]
      )
    }
  }

  const fallback = async (c: any) => {
    for (const e of codeEdits)
      await c.execute(
        `UPDATE MLAY_TAX SET CODE = :1
         WHERE YEAR = :2 AND USER_ID = :3 AND RECORD_TYPE = :4 AND CODE = :5`,
        [e.code || null, year, userId, e.recordType, e.orgCode]
      )
    for (const e of itemEdits)
      await c.execute(
        `UPDATE MLAY_TAX SET ITEM = :1
         WHERE YEAR = :2 AND USER_ID = :3 AND RECORD_TYPE = :4 AND ITEM = :5`,
        [e.item || null, year, userId, e.recordType, e.orgItem]
      )
  }

  const handle = async (c: any) => {
    try { await run(c) } catch (err: unknown) {
      if ((err as { errorNum?: number })?.errorNum === 942) await fallback(c)
      else throw err
    }
  }

  if (conn) await handle(conn)
  else await withConnection("ytts", handle)
}

// M 명령: MLAY_JAVA_EDIT에 upsert (MLAY_JAVA 원본 불변)
// M 저장: MLAY_JAVA_CODE_EDIT에 upsert (MLAY_JAVA 원본 불변)
export async function updateJavaCode(
  year:    number,
  userId:  number,
  updates: { seq: number; javaCode: string }[],
): Promise<void> {
  if (updates.length === 0) return
  await withConnection("ytts", async (conn) => {
    for (const u of updates) {
      await conn.execute(
        `MERGE INTO MLAY_JAVA_CODE_EDIT E USING DUAL
         ON (E.YEAR = :1 AND E.USER_ID = :2 AND E.SEQ = :3)
         WHEN MATCHED     THEN UPDATE SET E.JAVA_CODE = :4, E.EDIT_AT = SYSDATE
         WHEN NOT MATCHED THEN INSERT (YEAR, USER_ID, SEQ, JAVA_CODE)
                               VALUES (:1,  :2,      :3, :4)`,
        [year, userId, u.seq, u.javaCode || null]
      )
    }
  })
}

// M 복원: MLAY_JAVA_CODE_EDIT에서 삭제 (원본 복원)
export async function deleteJavaCodeEdits(
  year:   number,
  userId: number,
  resets: { seq: number }[],
): Promise<void> {
  if (resets.length === 0) return
  await withConnection("ytts", async (conn) => {
    await conn.executeMany(
      `DELETE FROM MLAY_JAVA_CODE_EDIT WHERE YEAR = :1 AND USER_ID = :2 AND SEQ = :3`,
      resets.map(r => [year, userId, r.seq])
    )
  })
}

// ── MAP 레코드 단위 재초기화 (편집 초기화 후 1:1 복원) ────────
export async function initMapForRecord(year: number, userId: number, record: string): Promise<void> {
  const [taxRows, allJavaRows] = await Promise.all([
    getTaxRows(year, userId, record),
    getJavaRows(year, userId, record),
  ])
  // LINE_NO=0 사용자 삽입 행 제외 — 원본 행으로만 1:1 초기화
  const javaRows = allJavaRows.filter(r => r.lineNo > 0)
  if (taxRows.length === 0 || javaRows.length === 0) return

  const len  = Math.max(taxRows.length, javaRows.length)
  const rows = Array.from({ length: len }, (_, i) =>
    [year, userId, i + 1, record, taxRows[i]?.seq ?? null, javaRows[i]?.seq ?? null] as
    [number, number, number, string, number | null, number | null]
  )

  await withConnection("ytts", async (conn) => {
    await conn.execute(
      `DELETE FROM MLAY_TAX_JAVA_MAP WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3`,
      [year, userId, record]
    )
    await conn.executeMany(
      `INSERT INTO MLAY_TAX_JAVA_MAP (YEAR, USER_ID, SORT_ORDER, RECORD_TYPE, TAX_SEQ, JAVA_SEQ)
       VALUES (:1, :2, :3, :4, :5, :6)`,
      rows
    )
  })
}

// ── MAP 초기 생성 (업로드 후 1:1 위치 매칭) ──────────────────
// HWP 또는 Java 업로드 완료 후 호출.
// Tax·Java 양쪽 모두 데이터가 있는 레코드에 대해서만 MAP을 생성.

export async function initMapFromDB(year: number, userId: number): Promise<void> {
  const [allTax, allJavaRaw] = await Promise.all([
    getTaxRows(year, userId),
    getJavaRows(year, userId),
  ])
  // LINE_NO=0 사용자 삽입 행 제외 — 원본 행으로만 1:1 초기화
  const allJava = allJavaRaw.filter(r => r.lineNo > 0)
  if (allTax.length === 0 || allJava.length === 0) return

  // 레코드별 그룹화
  const taxByRec:  Record<string, TaxLayoutRow[]> = {}
  const javaByRec: Record<string, JavaField[]>    = {}
  for (const r of allTax)  { const k = r.코드[0]; if (k) (taxByRec[k]  = taxByRec[k]  || []).push(r) }
  for (const r of allJava) {                              (javaByRec[r.record] = javaByRec[r.record] || []).push(r) }

  // 양쪽 모두 있는 레코드만 MAP 생성
  const rows: [number, number, number, string, number | null, number | null][] = []
  for (const rec of Object.keys(taxByRec)) {
    const taxRows  = taxByRec[rec]  ?? []
    const javaRows = javaByRec[rec] ?? []
    if (javaRows.length === 0) continue
    const len = Math.max(taxRows.length, javaRows.length)
    for (let i = 0; i < len; i++) {
      rows.push([year, userId, i + 1, rec, taxRows[i]?.seq ?? null, javaRows[i]?.seq ?? null])
    }
  }
  if (rows.length === 0) return

  await withConnection("ytts", async (conn) => {
    await conn.execute(
      `DELETE FROM MLAY_TAX_JAVA_MAP WHERE YEAR = :1 AND USER_ID = :2`,
      [year, userId]
    )
    await conn.executeMany(
      `INSERT INTO MLAY_TAX_JAVA_MAP (YEAR, USER_ID, SORT_ORDER, RECORD_TYPE, TAX_SEQ, JAVA_SEQ)
       VALUES (:1, :2, :3, :4, :5, :6)`,
      rows
    )
  })
}

// ── 원본 Java 소스 텍스트 조회 ───────────────────────────────

export async function getJavaSourceText(year: number, userId: number): Promise<string | null> {
  const rows = await yttsDb.query<Record<string, unknown>>(
    `SELECT JAVA_DATA FROM MLAY_JAVA_FILE WHERE YEAR = :1 AND USER_ID = :2`,
    [year, userId]
  )
  return rows.length ? ((rows[0].JAVA_DATA as string) ?? null) : null
}

// ── 레코드별 편집 초기화 (D/I/M 전체 삭제 후 MAP 1:1 재생성) ──

export async function resetJavaEdits(year: number, userId: number, record: string): Promise<number> {
  // MAP 재생성을 위해 트랜잭션 전에 원본 행 조회 (LINE_NO=0 제외)
  const [taxRows, allJavaRows] = await Promise.all([
    getTaxRows(year, userId, record),
    getJavaRows(year, userId, record),
  ])
  const javaRows = allJavaRows.filter(r => r.lineNo > 0)

  let deleted = 0
  await withConnection("ytts", async (conn) => {
    // MAP 초기화 (ROW_TYPE='D'/'I'/'O' 포함 전체)
    const mapRes = await conn.execute(
      `DELETE FROM MLAY_TAX_JAVA_MAP WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3`,
      [year, userId, record]
    )
    // 사용자 삽입 Java 행(LINE_NO=0) 삭제
    await conn.execute(
      `DELETE FROM MLAY_JAVA WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3 AND LINE_NO = 0`,
      [year, userId, record]
    )
    // M 편집(MLAY_JAVA_CODE_EDIT) 초기화
    const editRes = await conn.execute(
      `DELETE FROM MLAY_JAVA_CODE_EDIT
       WHERE YEAR = :1 AND USER_ID = :2
         AND SEQ IN (
           SELECT SEQ FROM MLAY_JAVA
           WHERE YEAR = :3 AND USER_ID = :4 AND RECORD_TYPE = :5
         )`,
      [year, userId, year, userId, record]
    )
    deleted = ((mapRes.rowsAffected ?? 0) as number) + ((editRes.rowsAffected ?? 0) as number)

    // MAP 1:1 재생성
    if (taxRows.length > 0 && javaRows.length > 0) {
      const len  = Math.max(taxRows.length, javaRows.length)
      const rows = Array.from({ length: len }, (_, i) =>
        [year, userId, i + 1, record, taxRows[i]?.seq ?? null, javaRows[i]?.seq ?? null] as
        [number, number, number, string, number | null, number | null]
      )
      await conn.executeMany(
        `INSERT INTO MLAY_TAX_JAVA_MAP (YEAR, USER_ID, SORT_ORDER, RECORD_TYPE, TAX_SEQ, JAVA_SEQ)
         VALUES (:1, :2, :3, :4, :5, :6)`,
        rows
      )
    }
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
  const [hwpFile, javaFile, taxAgg, javaAgg, mEdits, sectConfigs] = await Promise.all([
    getLatestHwpFile(userId).then(f => f?.year === year ? f : getHwpFile(year, userId)),
    getJavaFile(year, userId),
    yttsDb.query<Record<string, unknown>>(
      `SELECT RECORD_TYPE, SUM(NVL(FIELD_LEN,0)) AS BYTES FROM MLAY_TAX WHERE YEAR = :1 AND USER_ID = :2 GROUP BY RECORD_TYPE`,
      [year, userId]
    ),
    yttsDb.query<Record<string, unknown>>(
      `SELECT J.RECORD_TYPE, SUM(NVL(J.FIELD_LEN,0)) AS BYTES
       FROM MLAY_JAVA J
       WHERE J.YEAR = :1 AND J.USER_ID = :2
         AND NOT EXISTS (
           SELECT 1 FROM MLAY_TAX_JAVA_MAP M
           WHERE M.YEAR = :1 AND M.USER_ID = :2
             AND M.JAVA_SEQ = J.SEQ
             AND M.ROW_TYPE = 'D'
         )
       GROUP BY J.RECORD_TYPE`,
      [year, userId]
    ),
    // M-편집: EDITED_RAW로 바뀐 길이를 보정 (LINE_NO=0 I-행은 CODE_EDIT 없으므로 영향 없음)
    yttsDb.query<Record<string, unknown>>(
      `SELECT J.RECORD_TYPE, NVL(J.FIELD_LEN,0) AS ORIG_LEN, E.JAVA_CODE AS EDITED_CODE
       FROM MLAY_JAVA_CODE_EDIT E
       JOIN MLAY_JAVA J ON J.YEAR = :1 AND J.USER_ID = :2 AND J.SEQ = E.SEQ
       WHERE E.YEAR = :3 AND E.USER_ID = :4
         AND NOT EXISTS (
           SELECT 1 FROM MLAY_TAX_JAVA_MAP M
           WHERE M.YEAR = :3 AND M.USER_ID = :4
             AND M.JAVA_SEQ = E.SEQ
             AND M.ROW_TYPE = 'D'
         )`,
      [year, userId, year, userId]
    ),
    getAllTaxSectConfigs(year, userId, "TAX"),
  ])
  const taxBytes: Record<string, number> = {}
  for (const r of taxAgg)  taxBytes[r.RECORD_TYPE  as string] = (r.BYTES  as number) ?? 0
  const javaBytes: Record<string, number> = {}
  for (const r of javaAgg) javaBytes[r.RECORD_TYPE as string] = (r.BYTES  as number) ?? 0

  // M-편집으로 바뀐 makeStr 길이 보정 (MLAY_JAVA.FIELD_LEN은 편집 시 갱신 안 됨)
  const MAKE_STR_RE = /^makeStr\s*\(\s*"([X9])"\s*,\s*(\d{1,4})\s*,\s*[\s\S]+\)\s*$/i
  for (const e of mEdits) {
    const rec      = e.RECORD_TYPE  as string
    const origLen  = (e.ORIG_LEN   as number) ?? 0
    const edited   = (e.EDITED_CODE as string) ?? ""
    const m        = MAKE_STR_RE.exec(edited.trim())
    const newLen   = m ? parseInt(m[2]) : origLen
    if (newLen !== origLen && rec in javaBytes) {
      javaBytes[rec] = javaBytes[rec] - origLen + newLen
    }
  }

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

// ── MLAY_ITEM_NOTE CRUD ───────────────────────────────────────

const TS_FMT = `TO_CHAR(%s, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

function toNoteRow(r: Record<string, unknown>): ItemNoteRow {
  return {
    year:       r.YEAR        as number,
    userId:     r.USER_ID     as number,
    recordType: r.RECORD_TYPE as string,
    code:       r.CODE        as string,
    memo:       (r.MEMO       as string) ?? "",
    isDone:     (r.IS_DONE    as number) === 1,
    color:      (r.COLOR      as string) ?? "yellow",
    createdAt:  (r.CREATED_AT as string) ?? "",
    updatedAt:  (r.UPDATED_AT as string) ?? "",
  }
}

export interface ParseLogEntry {
  recordType: string
  code:       string
  origText:   string
  cleanText:  string | null
}

export async function getParseLogs(year: number, userId: number): Promise<ParseLogEntry[]> {
  try {
    const rows = await yttsDb.query<Record<string, unknown>>(
      `SELECT RECORD_TYPE, CODE, ORIG_TEXT, CLEAN_TEXT
       FROM MLAY_HWP_PARSE_LOG
       WHERE YEAR = :1 AND USER_ID = :2
       ORDER BY LOG_SEQ`,
      [year, userId]
    )
    return rows.map(r => ({
      recordType: String(r["RECORD_TYPE"] ?? ""),
      code:       String(r["CODE"] ?? ""),
      origText:   String(r["ORIG_TEXT"] ?? ""),
      cleanText:  r["CLEAN_TEXT"] != null ? String(r["CLEAN_TEXT"]) : null,
    }))
  } catch {
    return []
  }
}

export async function getItemNotes(
  year:   number,
  userId: number,
  record?: string,
): Promise<ItemNoteRow[]> {
  const where = record ? "AND RECORD_TYPE = :3" : ""
  const params: unknown[] = record ? [year, userId, record] : [year, userId]
  try {
    const rows = await yttsDb.query<Record<string, unknown>>(
      `SELECT YEAR, USER_ID, RECORD_TYPE, CODE, MEMO, IS_DONE, COLOR,
              ${TS_FMT.replace("%s", "CREATED_AT")} AS CREATED_AT,
              ${TS_FMT.replace("%s", "UPDATED_AT")} AS UPDATED_AT
       FROM MLAY_ITEM_NOTE
       WHERE YEAR = :1 AND USER_ID = :2 ${where}
       ORDER BY RECORD_TYPE, CREATED_AT`,
      params
    )
    return rows.map(toNoteRow)
  } catch { return [] }
}

export async function upsertItemNote(
  year:   number,
  userId: number,
  note:   { recordType: string; code: string; memo: string; isDone: boolean; color: string },
): Promise<void> {
  await yttsDb.execute(
    `MERGE INTO MLAY_ITEM_NOTE N USING DUAL
     ON (N.YEAR = :1 AND N.USER_ID = :2 AND N.RECORD_TYPE = :3 AND N.CODE = :4)
     WHEN MATCHED THEN
       UPDATE SET N.MEMO = :5, N.IS_DONE = :6, N.COLOR = :7, N.UPDATED_AT = SYSTIMESTAMP
     WHEN NOT MATCHED THEN
       INSERT (YEAR, USER_ID, RECORD_TYPE, CODE, MEMO, IS_DONE, COLOR, CREATED_AT, UPDATED_AT)
       VALUES (:1, :2, :3, :4, :5, :6, :7, SYSTIMESTAMP, SYSTIMESTAMP)`,
    [year, userId, note.recordType, note.code, note.memo, note.isDone ? 1 : 0, note.color]
  )
}

export async function deleteItemNote(
  year:   number,
  userId: number,
  recordType: string,
  code:   string,
): Promise<void> {
  await yttsDb.execute(
    `DELETE FROM MLAY_ITEM_NOTE
     WHERE YEAR = :1 AND USER_ID = :2 AND RECORD_TYPE = :3 AND CODE = :4`,
    [year, userId, recordType, code]
  )
}
