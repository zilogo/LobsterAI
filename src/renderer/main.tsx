import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store';
import App from './App';
import './index.css';
import { isElectron } from './platform';
import { WebAdapter } from './platform/WebAdapter';

// Web 模式 shim：将 WebAdapter 注入 window.electron，
// 使所有现有的 window.electron.xxx 调用在浏览器中正常工作。
if (!isElectron()) {
  (window as any).electron = new WebAdapter();
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find the root element');
}

try {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <Provider store={store}>
        <App />
      </Provider>
    </React.StrictMode>
  );
} catch (error) {
  console.error('Failed to render the app:', error);
}
