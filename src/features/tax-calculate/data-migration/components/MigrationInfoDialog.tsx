"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Button } from "@/components/ui/button"
import { Info, X } from "lucide-react"

const COMMON_FIELDS = [
  "CALC_NO → 'X{toYear}*'",
  "INS_ID, UPT_ID = 0000000",
  "INS_DT, UPT_DT = SYSDATE",
]

const ROWS: {
  group: "필수" | "선택"
  no: number
  table: string
  specific: string[]
  note?: string
}[] = [
  { group: "필수", no: 1,  table: "PAY_WRK_OBJ",            specific: ["BEL_FRM_DT", "BEL_TO_DT", "YY"] },
  { group: "필수", no: 2,  table: "PAY_WRK_MAIN",           specific: ["BEL_FRM_DT", "BEL_TO_DT", "YY"] },
  { group: "필수", no: 3,  table: "PAY_WRK_FMLY",           specific: ["RES_NO"], note: "경계나이(7·20·59·69세) 해당자는 공제요건 유지를 위해 대체 주민번호로 교체" },
  { group: "필수", no: 4,  table: "PAY_WRK_FMLY_DTL",       specific: [] },
  { group: "필수", no: 5,  table: "PAY_WRK_CALC",           specific: [], note: "세액계산에 사용되지 않지만 없으면 step_4 조회 시 오류가 남" },
  { group: "선택", no: 6,  table: "PAY_WRK_SUB",            specific: ["ENT_DT", "RSIGN_DT", "CUT_TAX_FRM_DT", "CUT_TAX_TO_DT"] },
  { group: "선택", no: 7,  table: "PAY_WRK_MEDI",           specific: [] },
  { group: "선택", no: 8,  table: "PAY_WRK_GIFT",           specific: [] },
  { group: "선택", no: 9,  table: "PAY_WRK_GIFT_ADJ",       specific: ["GIFT_YY"] },
  { group: "선택", no: 10, table: "PAY_WRK_PEN_SAVE_SPEC",  specific: ["INVST_YY"] },
  { group: "선택", no: 11, table: "PAY_WRK_RENT_HABT_SPEC", specific: ["CNTRCT_FRM_DT", "CNTRCT_TO_DT"] },
  { group: "선택", no: 12, table: "PAY_WRK_NTS_SOC_INSU",   specific: [] },
  { group: "선택", no: 13, table: "PAY_WRK_MAIN_PAY",       specific: ["YYMM"], note: "계산에 사용되지 않지만 없으면 NTAX 생성 시 오류가 남" },
  { group: "선택", no: 14, table: "PAY_WRK_MAIN_NTAX",      specific: ["YYMM"] },
  { group: "선택", no: 15, table: "PAY_WRK_SUB_NTAX",       specific: [] },
]

export function MigrationInfoDialog({ toYear }: { toYear: string }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        render={
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" title="마이그레이션 안내" />
        }
      >
        <Info className="h-4 w-4" />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background shadow-xl transition duration-150 data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95">
          {/* 헤더 */}
          <div className="flex items-center justify-between border-b px-5 py-3.5">
            <div>
              <Dialog.Title className="text-base font-semibold">마이그레이션 대상 테이블 안내</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground mt-0.5">
                Y{String(Number(toYear) - 1)} → X{toYear} 데이터 변환 규칙
              </Dialog.Description>
            </div>
            <Dialog.Close
              render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" />}
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* 공통필드 안내 */}
          <div className="flex items-center gap-3 bg-muted/50 px-5 py-2.5 border-b">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">공통필드</span>
            <div className="flex gap-4">
              {COMMON_FIELDS.map(f => (
                <code key={f} className="text-xs bg-background border rounded px-2 py-0.5 font-mono">
                  {f.replace("{toYear}", toYear)}
                </code>
              ))}
            </div>
          </div>

          {/* 테이블 */}
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                <tr>
                  <th className="border-b px-3 py-2 text-left text-xs font-semibold text-muted-foreground w-12">구분</th>
                  <th className="border-b px-3 py-2 text-center text-xs font-semibold text-muted-foreground w-8">#</th>
                  <th className="border-b px-3 py-2 text-left text-xs font-semibold text-muted-foreground">테이블</th>
                  <th className="border-b px-3 py-2 text-left text-xs font-semibold text-muted-foreground">특정필드 (연도 변환)</th>
                  <th className="border-b px-3 py-2 text-left text-xs font-semibold text-muted-foreground">비고</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row, i) => {
                  const isFirstInGroup = i === 0 || ROWS[i - 1].group !== row.group
                  const groupSize = ROWS.filter(r => r.group === row.group).length
                  const isMust = row.group === "필수"

                  return (
                    <tr key={row.no} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      {isFirstInGroup && (
                        <td rowSpan={groupSize} className="border-r px-3 py-2 text-center align-middle">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                            isMust ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                          }`}>
                            {row.group}
                          </span>
                        </td>
                      )}
                      <td className="border-r px-3 py-2 text-center text-xs text-muted-foreground tabular-nums">{row.no}</td>
                      <td className="border-r px-3 py-2 font-mono text-xs font-medium">{row.table}</td>
                      <td className="border-r px-3 py-2">
                        {row.specific.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {row.specific.map(f => (
                              <code key={f} className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono text-foreground">
                                {f}
                              </code>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{row.note ?? ""}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
