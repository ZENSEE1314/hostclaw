/* ChatsAI — Shared JavaScript */

// Inject favicon if not already set
if (!document.querySelector('link[rel="icon"]')) {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = '/favicon.svg';
  document.head.appendChild(link);
}

const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:10000'
  : 'https://hostclaw-production-8e47.up.railway.app';

// Auth token
function getToken() {
  return localStorage.getItem('token');
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

// API helper
async function api(path, options = {}) {
  const token = getToken();
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    },
    ...options
  };

  const res = await fetch(`${API_URL}${path}`, config);

  if (res.status === 401) {
    // Don't redirect if there's an OAuth token in the URL (Google login callback)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('token')) {
      // OAuth token in URL — save it and retry
      localStorage.setItem('token', urlParams.get('token'));
      window.history.replaceState({}, document.title, window.location.pathname);
      // Retry the request with the new token
      const retryConfig = { ...config, headers: { ...config.headers, 'Authorization': `Bearer ${urlParams.get('token')}` } };
      const retryRes = await fetch(`${API_URL}${path}`, retryConfig);
      if (retryRes.ok) return retryRes.json();
    }
    localStorage.removeItem('token');
    window.location.href = '/login.html';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }

  return res.json();
}

// Toast notifications
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

function showToast(message, type = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '&#10003;', error: '&#10007;', warning: '&#9888;', info: '&#8505;' };
  toast.innerHTML = `
    <span style="font-size:1.125rem">${icons[type] || icons.info}</span>
    <span class="toast-msg">${message}</span>
  `;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastIn 0.3s ease reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Modal helpers
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

// Sidebar toggle (mobile)
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.classList.toggle('open');
}

// Format numbers
function formatNumber(n) {
  if (n === Infinity || n === null) return 'Unlimited';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
  return n.toLocaleString();
}

// Relative time
function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
  return new Date(date).toLocaleDateString();
}

// Logout
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
}
