type Row = Record<string, unknown>

// key: "Y2025XXXXXX_2" 형태의 원본 CALC_NO + FMLY_SEQ
export type DefectMap = Map<string, { CHG_RES_NO: string; CHG_FMLY_NM: string }>

export interface ScriptConfig {
  id: string
  table: string
  transformRow: (row: Row, index: number) => Row
  getSubstituted?: () => number
}

function replaceYear(val: unknown, toYear: string): string {
  return toYear + String(val).substring(4)
}

function yearPlusOne(val: unknown): string {
  const s = String(val)
  return String(Number(s.substring(0, 4)) + 1) + s.substring(4)
}

function baseTransform(row: Row, fromYear: string, toYear: string): Row {
  const newRow = { ...row }
  if (newRow.CALC_NO)
    newRow.CALC_NO = String(newRow.CALC_NO).replace(new RegExp(`Y${fromYear}`, "g"), `X${toYear}`)
  newRow.INS_ID = "0000000"
  newRow.UPT_ID = "0000000"
  delete newRow.INS_DT
  delete newRow.UPT_DT
  return newRow
}

export function createScripts(fromYear: string, toYear: string, defectMap?: DefectMap): ScriptConfig[] {
  return [
    {
      id: "c01",
      table: "PAY_WRK_OBJ",
      transformRow(row, index) {
        if (!row.BEL_FRM_DT || String(row.BEL_FRM_DT).substring(0, 4) !== fromYear)
          throw new Error(`[Row ${index + 1}, CALC_NO: ${row.CALC_NO}] BEL_FRM_DT가 없거나 ${fromYear}년 데이터가 아닙니다: ${row.BEL_FRM_DT}`)
        if (!row.BEL_TO_DT || String(row.BEL_TO_DT).substring(0, 4) !== fromYear)
          throw new Error(`[Row ${index + 1}, CALC_NO: ${row.CALC_NO}] BEL_TO_DT가 없거나 ${fromYear}년 데이터가 아닙니다: ${row.BEL_TO_DT}`)
        if (String(row.YY) !== fromYear)
          throw new Error(`[Row ${index + 1}, CALC_NO: ${row.CALC_NO}] YY 값이 ${fromYear}가 아닙니다: ${row.YY}`)
        const newRow = baseTransform(row, fromYear, toYear)
        newRow.BEL_FRM_DT = replaceYear(row.BEL_FRM_DT, toYear)
        newRow.BEL_TO_DT = replaceYear(row.BEL_TO_DT, toYear)
        newRow.YY = toYear
        return newRow
      }
    },
    {
      id: "c02",
      table: "PAY_WRK_MAIN",
      transformRow(row, index) {
        if (!row.BEL_FRM_DT || String(row.BEL_FRM_DT).substring(0, 4) !== fromYear)
          throw new Error(`[Row ${index + 1}, CALC_NO: ${row.CALC_NO}] BEL_FRM_DT가 없거나 ${fromYear}년 데이터가 아닙니다: ${row.BEL_FRM_DT}`)
        if (!row.BEL_TO_DT || String(row.BEL_TO_DT).substring(0, 4) !== fromYear)
          throw new Error(`[Row ${index + 1}, CALC_NO: ${row.CALC_NO}] BEL_TO_DT가 없거나 ${fromYear}년 데이터가 아닙니다: ${row.BEL_TO_DT}`)
        if (String(row.YY) !== fromYear)
          throw new Error(`[Row ${index + 1}, CALC_NO: ${row.CALC_NO}] YY 값이 '${fromYear}'가 아닙니다: ${row.YY}`)
        const newRow = baseTransform(row, fromYear, toYear)
        newRow.BEL_FRM_DT = replaceYear(row.BEL_FRM_DT, toYear)
        newRow.BEL_TO_DT = replaceYear(row.BEL_TO_DT, toYear)
        newRow.YY = toYear
        return newRow
      }
    },
    (() => {
      let substituted = 0
      return {
        id: "c03",
        table: "PAY_WRK_FMLY",
        transformRow(row) {
          const newRow = baseTransform(row, fromYear, toYear)
          if (defectMap) {
            const key = `${row.CALC_NO}_${row.FMLY_SEQ}`
            const defect = defectMap.get(key)
            if (defect?.CHG_RES_NO && defect?.CHG_FMLY_NM) {
              newRow.RES_NO = defect.CHG_RES_NO
              newRow.NM    = defect.CHG_FMLY_NM
              substituted++
            }
          }
          return newRow
        },
        getSubstituted: () => substituted,
      }
    })(),
    {
      id: "c04",
      table: "PAY_WRK_FMLY_DTL",
      transformRow(row) { return baseTransform(row, fromYear, toYear) }
    },
    {
      id: "c05",
      table: "PAY_WRK_CALC",
      transformRow(row) { return baseTransform(row, fromYear, toYear) }
    },
    {
      id: "c06",
      table: "PAY_WRK_SUB",
      transformRow(row, index) {
        if (!row.ENT_DT || String(row.ENT_DT).substring(0, 4) !== fromYear)
          throw new Error(`[Row ${index + 1}, CALC_NO: ${row.CALC_NO}] ENT_DT가 없거나 ${fromYear}년 데이터가 아닙니다: ${row.ENT_DT}`)
        if (!row.RSIGN_DT || String(row.RSIGN_DT).substring(0, 4) !== fromYear)
          throw new Error(`[Row ${index + 1}, CALC_NO: ${row.CALC_NO}] RSIGN_DT가 없거나 ${fromYear}년 데이터가 아닙니다: ${row.RSIGN_DT}`)
        if (row.CUT_TAX_FRM_DT && String(row.CUT_TAX_FRM_DT).substring(0, 4) !== fromYear)
          throw new Error(`[Row ${index + 1}, CALC_NO: ${row.CALC_NO}] CUT_TAX_FRM_DT가 ${fromYear}년 데이터가 아닙니다: ${row.CUT_TAX_FRM_DT}`)
        if (row.CUT_TAX_TO_DT && String(row.CUT_TAX_TO_DT).substring(0, 4) !== fromYear)
          throw new Error(`[Row ${index + 1}, CALC_NO: ${row.CALC_NO}] CUT_TAX_TO_DT가 ${fromYear}년 데이터가 아닙니다: ${row.CUT_TAX_TO_DT}`)
        const newRow = baseTransform(row, fromYear, toYear)
        newRow.ENT_DT = replaceYear(row.ENT_DT, toYear)
        newRow.RSIGN_DT = replaceYear(row.RSIGN_DT, toYear)
        if (row.CUT_TAX_FRM_DT) newRow.CUT_TAX_FRM_DT = replaceYear(row.CUT_TAX_FRM_DT, toYear)
        if (row.CUT_TAX_TO_DT) newRow.CUT_TAX_TO_DT = replaceYear(row.CUT_TAX_TO_DT, toYear)
        return newRow
      }
    },
    {
      id: "c07",
      table: "PAY_WRK_MEDI",
      transformRow(row) { return baseTransform(row, fromYear, toYear) }
    },
    {
      id: "c08",
      table: "PAY_WRK_GIFT",
      transformRow(row) { return baseTransform(row, fromYear, toYear) }
    },
    {
      id: "c09",
      table: "PAY_WRK_GIFT_ADJ",
      transformRow(row) {
        const newRow = baseTransform(row, fromYear, toYear)
        if (newRow.GIFT_YY) newRow.GIFT_YY = String(Number(newRow.GIFT_YY) + 1)
        return newRow
      }
    },
    {
      id: "c10",
      table: "PAY_WRK_PEN_SAVE_SPEC",
      transformRow(row, index) {
        if (row.INVST_YY != null) {
          const yyNum = Number(row.INVST_YY)
          const fromNum = Number(fromYear)
          if (!([fromNum - 2, fromNum - 1, fromNum].includes(yyNum)))
            throw new Error(`[Row ${index + 1}, CALC_NO: ${row.CALC_NO}] INVST_YY 허용 범위(${fromNum - 2}~${fromNum}) 벗어남: ${row.INVST_YY}`)
        }
        const newRow = baseTransform(row, fromYear, toYear)
        if (newRow.INVST_YY) newRow.INVST_YY = String(Number(newRow.INVST_YY) + 1)
        return newRow
      }
    },
    {
      id: "c11",
      table: "PAY_WRK_RENT_HABT_SPEC",
      transformRow(row) {
        const newRow = baseTransform(row, fromYear, toYear)
        if (newRow.CNTRCT_FRM_DT) newRow.CNTRCT_FRM_DT = yearPlusOne(newRow.CNTRCT_FRM_DT)
        if (newRow.CNTRCT_TO_DT) newRow.CNTRCT_TO_DT = yearPlusOne(newRow.CNTRCT_TO_DT)
        return newRow
      }
    },
    {
      id: "c12",
      table: "PAY_WRK_NTS_SOC_INSU",
      transformRow(row) { return baseTransform(row, fromYear, toYear) }
    },
    {
      id: "c13",
      table: "PAY_WRK_MAIN_PAY",
      transformRow(row) {
        const newRow = baseTransform(row, fromYear, toYear)
        if (newRow.YYMM) newRow.YYMM = yearPlusOne(newRow.YYMM)
        return newRow
      }
    },
    {
      id: "c14",
      table: "PAY_WRK_MAIN_NTAX",
      transformRow(row) {
        const newRow = baseTransform(row, fromYear, toYear)
        if (newRow.YYMM) newRow.YYMM = yearPlusOne(newRow.YYMM)
        return newRow
      }
    },
    {
      id: "c15",
      table: "PAY_WRK_SUB_NTAX",
      transformRow(row) { return baseTransform(row, fromYear, toYear) }
    },
  ]
}

export const SCRIPT_META = [
  { id: "c01", table: "PAY_WRK_OBJ" },
  { id: "c02", table: "PAY_WRK_MAIN" },
  { id: "c03", table: "PAY_WRK_FMLY" },
  { id: "c04", table: "PAY_WRK_FMLY_DTL" },
  { id: "c05", table: "PAY_WRK_CALC" },
  { id: "c06", table: "PAY_WRK_SUB" },
  { id: "c07", table: "PAY_WRK_MEDI" },
  { id: "c08", table: "PAY_WRK_GIFT" },
  { id: "c09", table: "PAY_WRK_GIFT_ADJ" },
  { id: "c10", table: "PAY_WRK_PEN_SAVE_SPEC" },
  { id: "c11", table: "PAY_WRK_RENT_HABT_SPEC" },
  { id: "c12", table: "PAY_WRK_NTS_SOC_INSU" },
  { id: "c13", table: "PAY_WRK_MAIN_PAY" },
  { id: "c14", table: "PAY_WRK_MAIN_NTAX" },
  { id: "c15", table: "PAY_WRK_SUB_NTAX" },
]

export const DELETE_ORDER = [
  "PAY_WRK_SUB_NTAX",
  "PAY_WRK_MAIN_NTAX",
  "PAY_WRK_MAIN_PAY",
  "PAY_WRK_NTS_SOC_INSU",
  "PAY_WRK_RENT_HABT_SPEC",
  "PAY_WRK_PEN_SAVE_SPEC",
  "PAY_WRK_GIFT_ADJ",
  "PAY_WRK_GIFT",
  "PAY_WRK_MEDI",
  "PAY_WRK_SUB",
  "PAY_WRK_CALC",
  "PAY_WRK_FMLY_DTL",
  "PAY_WRK_FMLY",
  "PAY_WRK_MAIN",
  "PAY_WRK_OBJ",
]
