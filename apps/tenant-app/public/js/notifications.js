/* Tenant notifications client */
(function(){
    console.log('[NOTIFICATIONS] Loaded');
    const tenantId = document.body.dataset.tenantId;
    const badge = document.getElementById('notif-badge');
    const dropdown = document.getElementById('notif-dropdown');
    const markAllBtn = document.getElementById('markAllRead') || document.getElementById('markAllReadBtn');
    const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

    const showBadge = (count) => {
        if (!badge) return;
        if (!count || count <= 0) {
            badge.style.display = 'none';
        } else {
            badge.style.display = 'inline-block';
            badge.textContent = count > 99 ? '99+' : String(count);
        }
    };

    async function fetchCount() {
        try {
            const res = await fetch('/tenant/notifications/count', { credentials: 'include' });
            if (!res.ok) throw new Error(`Notification count failed: ${res.status}`);
            const data = await res.json();
            showBadge(data.count || 0);
        } catch (e) { console.error('Notif count error', e); }
    }

    async function fetchLatest() {
        try {
            const res = await fetch('/tenant/notifications/recent', { credentials: 'include' });
            if (!res.ok) throw new Error(`Notification recent failed: ${res.status}`);
            const data = await res.json();
            if (data && Array.isArray(data.notifications) && dropdown) {
                dropdown.innerHTML = '';
                data.notifications.forEach(n => {
                    const item = document.createElement('a');
                    item.className = 'd-block p-2 border-bottom notif-item text-dark';
                    item.href = n.metadata && (n.metadata.url || n.metadata.path) ? (n.metadata.url || n.metadata.path) : '#';
                    item.dataset.id = n._id;
                    item.dataset.url = (n.metadata && (n.metadata.url || n.metadata.path)) || '';
                    const time = n.createdAt ? new Date(n.createdAt).toLocaleString() : '';
                    item.innerHTML = `<div class="d-flex justify-content-between"><strong>${n.title}</strong><small class="text-muted">${time}</small></div><div class="text-muted small">${n.message}</div><div class="text-muted small mt-1"><em>${n.type || ''}</em></div>`;
                    dropdown.appendChild(item);
                });
                if (data.notifications.length === 0) dropdown.innerHTML = '<p class="text-muted m-2">No notifications</p>';
            }
        } catch (e) { console.error('fetchLatest notifications error', e); }
    }

    async function markAllRead() {
        try {
            const res = await fetch('/tenant/notifications/read-all', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) } });
            const data = await res.json(); if (data && data.success) showBadge(0);
        } catch (e) { console.error('Mark all read failed', e); }
    }

    if (markAllBtn) markAllBtn.addEventListener('click', (e) => { e.preventDefault(); markAllRead(); });

    // click handler for notification items
    if (dropdown) {
        dropdown.addEventListener('click', async (e) => {
            const item = e.target.closest('.notif-item');
            if (!item) return;
            const id = item.dataset.id;
            const url = item.dataset.url;
            e.preventDefault();
            try {
                await fetch(`/tenant/notifications/${id}/read`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(csrf ? { 'X-CSRF-Token': csrf } : {})
                    }
                });
            } catch (err) { console.error('mark read click failed', err); }
            if (url && url !== '#') window.location.href = url;
        });
    }

    // Setup Socket.IO if available
    try {
        if (typeof io !== 'undefined' && tenantId) {
            const socket = io({ query: { tenantId } });
            console.log('[NOTIFICATIONS] Socket initialized');
            socket.on('notification:new', (payload) => {
                try {
                    if (payload && payload.userType === 'tenant' && String(payload.tenantId) === String(tenantId)) {
                        const current = parseInt(badge?.textContent || '0') || 0; showBadge(current + 1);
                        if (dropdown) {
                            const n = payload.notification;
                            const item = document.createElement('div'); item.className = 'p-2 border-bottom'; item.innerHTML = `<strong>${n.title}</strong><div class="text-muted small">${n.message}</div>`; dropdown.insertBefore(item, dropdown.firstChild);
                        }
                    }
                } catch (e) { console.error(e); }
            });
        } else {
            if (typeof io === 'undefined') console.warn('Socket.IO client not found; realtime notifications disabled');
        }
    } catch (e) { console.error('Tenant socket init error', e); }

    // initial fetch
    fetchCount(); fetchLatest();
})();
