import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/index.css';

// xterm.js 내부 오류 억제 (IdleTaskQueue, handleResize, dimensions 등)
window.addEventListener('error', (event) => {
  if (event.message?.includes('handleResize') ||
      event.message?.includes('IdleTaskQueue') ||
      event.message?.includes('dimensions') ||
      event.message?.includes('Viewport')) {
    event.preventDefault();
    return false;
  }
});

// Unhandled rejection도 억제
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('dimensions') ||
      event.reason?.message?.includes('handleResize')) {
    event.preventDefault();
  }
});

// StrictMode 제거 - xterm.js와 충돌 방지
// HashRouter 사용 - Electron file:// 프로토콜 호환
ReactDOM.createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <App />
  </HashRouter>
);
