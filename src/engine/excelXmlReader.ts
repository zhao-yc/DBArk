import { SaxesParser } from 'saxes';
import type { ExcelZipArchive } from './excelZipBudget';

export type ExcelXmlEvent = { kind: 'open'; name: string; uri: string; attributes: Record<string, string> } | { kind: 'close'; name: string; uri: string } | { kind: 'text'; text: string };
const tokenLimit = 256 * 1024;

/** SAX 库不限制单 token，先逐字符限制文本/属性/注释/CDATA，阻止解析器积累巨型 token。 */
class XmlTokenBudget {
  private mode: 'text' | 'prefix' | 'tag' | 'comment' | 'cdata' | 'pi' = 'text';
  private count = 0;
  private prefix = '';
  private suffix = '';
  private quote = '';

  check(text: string): void {
    for (const character of text) {
      if (++this.count > tokenLimit) throw new Error('XLSX XML 单个文本、属性或标记超过安全上限');
      if (this.mode === 'text') {
        if (character === '<') { this.mode = 'prefix'; this.prefix = '<'; this.count = 1; }
        continue;
      }
      if (this.mode === 'prefix') {
        this.prefix += character;
        if (this.prefix === '<!--') { this.mode = 'comment'; this.suffix = ''; continue; }
        if (this.prefix === '<![CDATA[') { this.mode = 'cdata'; this.suffix = ''; continue; }
        if (this.prefix === '<?') { this.mode = 'pi'; this.suffix = ''; continue; }
        if ('<!--'.startsWith(this.prefix) || '<![CDATA['.startsWith(this.prefix)) continue;
        if (this.prefix.startsWith('<!')) throw new Error('XLSX 不允许 DTD 或自定义实体声明');
        this.mode = 'tag'; this.quote = '';
      }
      if (this.mode === 'tag') {
        if (this.quote) { if (character === this.quote) this.quote = ''; }
        else if (character === '"' || character === "'") this.quote = character;
        else if (character === '>') { this.mode = 'text'; this.count = 0; }
      } else {
        this.suffix = (this.suffix + character).slice(-3);
        const ended = this.mode === 'comment' ? this.suffix === '-->' : this.mode === 'cdata' ? this.suffix === ']]>' : this.suffix.endsWith('?>');
        if (ended) { this.mode = 'text'; this.count = 0; }
      }
    }
  }
}

/** XML 使用严格 UTF-8 流式解码和命名空间，深度/属性数/事件缓冲均有固定上限。 */
export async function* excelXmlEvents(zip: ExcelZipArchive, name: string): AsyncGenerator<ExcelXmlEvent> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const budget = new XmlTokenBudget(), parser = new SaxesParser({ xmlns: true });
  let depth = 0, queue: ExcelXmlEvent[] = [];
  parser.on('doctype', () => { throw new Error('XLSX 不允许 DTD 或外部实体'); });
  parser.on('error', () => { throw new Error('XLSX 包含无效 XML'); });
  parser.on('opentag', tag => {
    if (++depth > 64 || Object.keys(tag.attributes).length > 64) throw new Error('XLSX XML 嵌套或属性数量超限');
    const attributes: Record<string, string> = Object.create(null);
    for (const attribute of Object.values(tag.attributes)) {
      const key = attribute.uri ? `{${attribute.uri}}${attribute.local}` : attribute.local;
      attributes[key] = attribute.value;
    }
    queue.push({ kind: 'open', name: tag.local, uri: tag.uri, attributes });
  });
  parser.on('closetag', tag => { queue.push({ kind: 'close', name: tag.local, uri: tag.uri }); depth--; });
  parser.on('text', text => queue.push({ kind: 'text', text }));
  parser.on('cdata', text => queue.push({ kind: 'text', text }));
  try {
    for await (const chunk of zip.read(name)) {
      const text = decoder.decode(chunk, { stream: true });
      budget.check(text); parser.write(text);
      const current = queue; queue = [];
      for (const event of current) yield event;
    }
    const tail = decoder.decode(); budget.check(tail); parser.write(tail).close();
    for (const event of queue) yield event;
  } catch (error) {
    if (error instanceof TypeError) throw new Error('XLSX XML 必须使用有效 UTF-8 编码');
    throw error;
  }
}
