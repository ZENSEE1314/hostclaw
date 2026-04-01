/* HostClaw.ai — Sidebar Injection */

(function () {
  const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';

  function isActive(page) {
    return currentPage === page ? 'active' : '';
  }

  const sidebarHTML = `
    <button class="sidebar-toggle" onclick="toggleSidebar()">&#9776;</button>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <a href="/dashboard.html" class="sidebar-logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="lg" x1="0" y1="0" x2="24" y2="24"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="url(#lg)"/></svg>
          HostClaw.ai
        </a>
      </div>

      <nav class="sidebar-nav">
        <div class="nav-group">
          <div class="nav-group-title">Main</div>
          <a href="/dashboard.html" class="nav-link ${isActive('dashboard.html')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            Dashboard
          </a>
          <a href="/chat.html" class="nav-link ${isActive('chat.html')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Chat
          </a>
        </div>

        <div class="nav-group">
          <div class="nav-group-title">Bot Management</div>
          <a href="/agents.html" class="nav-link ${isActive('agents.html')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M3 21v-2a7 7 0 0 1 7-7h4a7 7 0 0 1 7 7v2"/></svg>
            AI Agents
          </a>
          <a href="/platforms.html" class="nav-link ${isActive('platforms.html')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            Platforms
          </a>
        </div>

        <div class="nav-group">
          <div class="nav-group-title">Settings</div>
          <a href="/providers.html" class="nav-link ${isActive('providers.html')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            AI Providers
          </a>
          <a href="/billing.html" class="nav-link ${isActive('billing.html')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            Billing
          </a>
          <a href="/settings.html" class="nav-link ${isActive('settings.html')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Settings
          </a>
        </div>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="sidebar-avatar" id="sidebarAvatar">?</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name" id="sidebarName">Loading...</div>
            <div class="sidebar-user-plan" id="sidebarPlan">Free Plan</div>
          </div>
          <button onclick="logout()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px" title="Logout">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
        <div class="sidebar-msg-bar" id="sidebarMsgBar">
          <div class="msg-bar-header">
            <span id="msgUsed">0 messages</span>
            <span id="msgLimit">/ 50</span>
          </div>
          <div class="msg-bar-track">
            <div class="msg-bar-fill" id="msgBarFill" style="width:0%"></div>
          </div>
        </div>
      </div>
    </aside>
  `;

  // Inject sidebar
  document.body.insertAdjacentHTML('afterbegin', sidebarHTML);

  // Load user data
  loadSidebarData();

  async function loadSidebarData() {
    try {
      const data = await api('/api/billing/credits');
      const nameEl = document.getElementById('sidebarName');
      const planEl = document.getElementById('sidebarPlan');
      const avatarEl = document.getElementById('sidebarAvatar');
      const msgUsed = document.getElementById('msgUsed');
      const msgLimit = document.getElementById('msgLimit');
      const msgFill = document.getElementById('msgBarFill');

      // Get user profile
      try {
        const profile = await api('/api/auth/profile');
        const user = profile.user || profile;
        if (nameEl) nameEl.textContent = user.name || 'User';
        if (avatarEl) avatarEl.textContent = (user.name || 'U').charAt(0).toUpperCase();
      } catch (e) {
        // Profile endpoint may not exist — use billing data
      }

      // Plan display
      const planType = data.plan_type || 'free';
      const planLabels = { free: 'Free Plan', paid: 'Paid Plan', unlimited: 'Unlimited', expired: 'Expired' };
      if (planEl) planEl.textContent = planLabels[planType] || 'Free Plan';

      // Message bar
      const count = data.message_count || 0;
      const limit = data.message_limit;
      const isUnlimited = data.is_unlimited;

      if (isUnlimited) {
        if (msgUsed) msgUsed.textContent = formatNumber(count) + ' sent';
        if (msgLimit) msgLimit.textContent = '/ Unlimited';
        if (msgFill) { msgFill.style.width = '100%'; msgFill.style.opacity = '0.3'; }
      } else {
        const total = limit || 50;
        const pct = Math.min(100, (count / total) * 100);
        if (msgUsed) msgUsed.textContent = formatNumber(count) + ' used';
        if (msgLimit) msgLimit.textContent = '/ ' + formatNumber(total);
        if (msgFill) {
          msgFill.style.width = pct + '%';
          if (pct > 90) msgFill.classList.add('danger');
          else if (pct > 70) msgFill.classList.add('warning');
        }
      }
    } catch (e) {
      console.error('Failed to load sidebar data:', e);
    }
  }

  // Close sidebar on outside click (mobile)
  document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.querySelector('.sidebar-toggle');
    if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && !toggle.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });
})();
