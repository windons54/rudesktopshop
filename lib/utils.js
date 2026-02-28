// lib/utils.js

export let _globalCurrency = null;

export function setGlobalCurrency(c) {
  _globalCurrency = c;
}

export function getCurrName(currency) {
  const c = currency || _globalCurrency;
  return (c && c.name) ? c.name : 'RuDeCoin';
}

export const compressImage = (dataUrl, maxW = 800, maxH = 800, quality = 0.7) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxW || height > maxH) {
        const ratio = Math.min(maxW / width, maxH / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

export const THEMES = {
  default:  { label: 'Корпоративный', primary: '#c71618', hover: '#a51214', light: 'rgba(199,22,24,0.06)',   dark: '#1a1a1a', bg: '#f7f8fa' },
  ocean:    { label: 'Океан',         primary: '#0ea5e9', hover: '#0284c7', light: 'rgba(14,165,233,0.07)',  dark: '#0f172a', bg: '#f0f9ff' },
  forest:   { label: 'Лес',           primary: '#059669', hover: '#047857', light: 'rgba(5,150,105,0.07)',   dark: '#064e3b', bg: '#f0fdf4' },
  violet:   { label: 'Виолет',        primary: '#7c3aed', hover: '#6d28d9', light: 'rgba(124,58,237,0.07)', dark: '#1e1b4b', bg: '#f5f3ff' },
  midnight: { label: 'Полночь',       primary: '#f59e0b', hover: '#d97706', light: 'rgba(245,158,11,0.07)', dark: '#18181b', bg: '#1c1917' },
  rose:     { label: 'Роза',          primary: '#e11d48', hover: '#be123c', light: 'rgba(225,29,72,0.07)',  dark: '#1f1235', bg: '#fff1f2' },
};

export function applyTheme(themeKey, customColors = {}) {
  const t = THEMES[themeKey] || THEMES.default;
  const r = document.documentElement.style;
  r.setProperty('--rd-red',      customColors.accentColor || t.primary);
  r.setProperty('--rd-red-hover', t.hover);
  r.setProperty('--rd-red-light', t.light);
  r.setProperty('--rd-dark',      t.dark);
  r.setProperty('--rd-gray-bg',   customColors.pageBg || t.bg);
}
