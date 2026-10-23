// 从 .docx（Office Open XML zip 包）中提取正文文字。
// 平台 ExtractDataFromUploadedFile 不支持 docx，这里自行解包 word/document.xml 并剥离标签。
import { unzipSync } from 'npm:fflate@0.8.2';

export async function extractDocxText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('文件下载失败 (' + res.status + ')');
  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf);
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('不是有效的 .docx 文件（缺少正文），请另存为 .docx 后重试');
  let xml = new TextDecoder().decode(doc);
  xml = xml
    .replace(/<w:tab[^>]*\/?>/g, '\t')
    .replace(/<w:br[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  const text = xml
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) throw new Error('未能从 .docx 中提取到文字，请另存为 PDF 或直接粘贴报价文字');
  return text;
}