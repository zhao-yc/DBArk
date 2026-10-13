import { createRoot } from 'react-dom/client';
import App from './App';
import 'react-data-grid/lib/styles.css';
import './styles.css';

/** 桌面入口只渲染界面，数据库与文件能力由受控桥接提供。 */
createRoot(document.getElementById('root')!).render(<App/>);
