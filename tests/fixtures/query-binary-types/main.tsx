import { createRoot } from 'react-dom/client';
import { ResultsGrid } from '../../../src/renderer/components/ResultsGrid';
import 'react-data-grid/lib/styles.css';
import '../../../src/renderer/styles.css';

// BLOB描述刻意同时承载字符串和字节；重复别名共享显示名称，但内部key唯一。
const columns = [{ key: 'c0', name: '重复别名', type: 'BLOB' }, { key: 'c1', name: '重复别名', type: 'BLOB' }, { key: 'c2', name: '可空文字', type: 'BLOB' }, { key: 'c3', name: '空字节', type: 'BLOB' }, { key: 'c4', name: '长文字', type: 'BLOB' }];
const rows = [{ c0: 'TEXT正文', c1: { type: 'binary' as const, base64: 'AP+A' }, c2: null, c3: { type: 'binary' as const, base64: '' }, c4: 'LONGTEXT正文\n第二行' }];
createRoot(document.getElementById('root')!).render(<div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><ResultsGrid columns={columns} rows={rows}/></div>);
