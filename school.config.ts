// 學校設定：老師部署前只需要改這個檔案。
// - classes：開放使用的班級代碼與年級（1–12）。代碼可用英數字與減號，最多 16 字。
// - timeZone：判斷與顯示開放／截止時間所用的時區。
// 學年（例如 115）放在環境變數 SCHOOL_YEAR，換學年時只改環境變數。
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
