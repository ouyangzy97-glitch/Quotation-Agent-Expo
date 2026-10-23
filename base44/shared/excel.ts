// 直接解析 Excel/CSV 表格为文本（每行一行、单元格以 Tab 分隔），保留原始行列结构。
// 平台 ExtractDataFromUploadedFile 对 Excel 做列→schema 映射，报价单列名不可预知会失败，因此自行解析。
import * as XLSX from 'npm:xlsx@0.18.5';

export async function extractSpreadsheetText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('文件下载失败 (' + res.status + ')');
  const buf = new Uint8Array(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'array' });
  const lines: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: '\t', blankrows: false });
    if (!csv.trim()) continue;
    lines.push('【工作表：' + name + '】');
    lines.push(csv.trimEnd());
  }
  const text = lines.join('\n').trim();
  if (!text) throw new Error('未能从表格文件中提取到内容，请确认文件为有效的 Excel/CSV');
  return text;
}