// 學校設定的「預設值」。一般老師不用改這個檔案：部署時填的
// SCHOOL_NAME、SCHOOL_CLASSES、SCHOOL_TIMEZONE 變數會覆蓋這裡的值。
// - classes：班級代碼與年級（1–12）。代碼可用英數字與減號，最多 16 字。
// - timeZone：判斷與顯示開放／截止時間所用的時區。
// 學年放在變數 SCHOOL_YEAR。
export const schoolConfig = {
  schoolName: '示範國中',
  timeZone: 'Asia/Taipei',
  classes: [
    { code: '801', grade: 8 },
    { code: '802', grade: 8 },
    { code: '901', grade: 9 },
    { code: '902', grade: 9 },
  ],
} as const satisfies {
  schoolName: string;
  timeZone: string;
  classes: ReadonlyArray<{ code: string; grade: number }>;
};
