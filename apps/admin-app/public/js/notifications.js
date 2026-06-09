/* Admin notifications client */
(function(){
    console.log('[NOTIFICATIONS] Loaded');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => console.log('[NOTIFICATIONS] DOM Ready'));
    } else {
        console.log('[NOTIFICATIONS] DOM Ready');
    }
    const adminId = document.body.dataset.adminId || (window.session && window.session.adminId);
    const badge = document.getElementById('admin-notif-badge');
    const dropdown = document.getElementById('admin-notif-dropdown');
    const markAllBtn = document.getElementById('adminMarkAllReadBtn');
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (!csrfToken) console.warn('[NOTIFICATIONS] CSRF token meta tag not found on page');

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
            const url = '/admin/notifications/count';
            console.log('Notification Request', url);
            console.log('CSRF', csrfToken);
            const res = await fetch(url, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' } });
            const data = await res.json();
            showBadge(data.count || 0);
        } catch (e) { console.error('Admin notif count error', e); showErrorToast('Unable to update notification'); }
    }

    async function fetchLatest() {
        try {
            const url = '/admin/notifications/recent';
            console.log('Notification Request', url);
            console.log('CSRF', csrfToken);
            const res = await fetch(url, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' } });
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
        } catch (e) { console.error('fetchLatest admin notifications error', e); }
    }

    async function markAllRead() {
        try {
            const url = '/admin/notifications/read-all';
            console.log('Notification Request', url);
            console.log('CSRF', csrfToken);
            const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) } });
            const data = await res.json(); if (data && data.success) {
                showBadge(0);
                // update UI: remove badges and disable buttons
                document.querySelectorAll('#admin-notifications-list .notif-new').forEach(b=>b.remove());
                document.querySelectorAll('#admin-notifications-list .mark-read-btn').forEach(btn=>{ btn.disabled = true; });
                showToast('All notifications marked read');
            } else {
                showErrorToast('Unable to update notification');
            }
        } catch (e) { console.error('Admin mark all read failed', e); showErrorToast('Unable to update notification'); }
    }

    if (markAllBtn) markAllBtn.addEventListener('click', (e) => { e.preventDefault(); markAllRead(); });
    // Also support legacy/admin page button id
    const adminMarkAll = document.getElementById('adminMarkAll');
    if (adminMarkAll) adminMarkAll.addEventListener('click', (e) => { e.preventDefault(); markAllRead(); });

    // click handler for notification items
    if (dropdown) {
            dropdown.addEventListener('click', async (e) => {
            const item = e.target.closest('.notif-item');
            if (!item) return;
            const id = item.dataset.id;
            const url = item.dataset.url;
            e.preventDefault();
            try {
                const reqUrl = `/admin/notifications/${id}/read`;
                console.log('Notification Request', reqUrl);
                console.log('CSRF', csrfToken);
                await fetch(reqUrl, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) } });
            } catch (err) { console.error('mark read click failed', err); showErrorToast('Unable to update notification'); }
            if (url && url !== '#') window.location.href = url;
        });
    }

    // Admin notifications page: per-item mark/read and delete actions
    try {
        const list = document.getElementById('admin-notifications-list');
        if (list) {
            list.addEventListener('click', async function(e){
                const markBtn = e.target.closest('.mark-read-btn');
                const delBtn = e.target.closest('.delete-notif-btn');
                const li = e.target.closest('li[data-id]');
                if (!li) return;
                const id = li.getAttribute('data-id');
                if (markBtn) {
                    try {
                        const reqUrl = '/admin/notifications/' + id + '/read';
                        console.log('Notification Request', reqUrl);
                        console.log('CSRF', csrfToken);
                        const res = await fetch(reqUrl, { method: 'POST', credentials: 'include', headers: { 'Content-Type':'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) } });
                        const j = await res.json();
                        if (j && j.success) {
                            li.querySelector('.notif-new')?.remove();
                            markBtn.disabled = true;
                            li.classList.remove('notification-unread'); li.classList.add('notif-read');
                            // update navbar count
                            fetchCount();
                        } else { showErrorToast('Unable to update notification'); }
                    } catch (e) { console.error(e); showErrorToast('Unable to update notification'); }
                }
                if (delBtn) {
                    if (!confirm('Delete this notification?')) return;
                    try {
                        const reqUrl = '/admin/notifications/' + id + '/delete';
                        console.log('Notification Request', reqUrl);
                        console.log('CSRF', csrfToken);
                        const res = await fetch(reqUrl, { method: 'POST', credentials: 'include', headers: { 'Content-Type':'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) } });
                        const j = await res.json(); if (j && j.success) {
                            li.remove();
                            showToast('Notification deleted');
                        } else { showErrorToast('Unable to update notification'); }
                        // update navbar count
                        fetchCount();
                    } catch (e) { console.error(e); showErrorToast('Unable to update notification'); }
                }
            });
        }
    } catch (e) { console.error('admin notifications page handler error', e); }

    // small helper toast
    function showToast(text){
        try{
            const t = document.createElement('div'); t.className = 'alert alert-success'; t.style.position = 'fixed'; t.style.right = '20px'; t.style.top = '20px'; t.style.zIndex = 9999; t.innerText = text;
            document.body.appendChild(t);
            setTimeout(()=>{ t.style.transition='opacity 400ms'; t.style.opacity=0; setTimeout(()=>t.remove(),500); }, 2500);
        }catch(e){ console.log(text); }
    }

    function showErrorToast(text){
        try{
            const t = document.createElement('div'); t.className = 'alert alert-danger'; t.style.position = 'fixed'; t.style.right = '20px'; t.style.top = '20px'; t.style.zIndex = 9999; t.innerText = text;
            document.body.appendChild(t);
            setTimeout(()=>{ t.style.transition='opacity 400ms'; t.style.opacity=0; setTimeout(()=>t.remove(),500); }, 4000);
        }catch(e){ console.error(text); }
    }

    // Setup Socket.IO if available (socket.io client should be loaded before this script)
    try {
        if (typeof io !== 'undefined' && adminId) {
            const socket = io({ query: { adminId } });
            console.log('[NOTIFICATIONS] Socket initialized');
            socket.on('notification:new', (payload) => {
                try {
                    if (payload && payload.userType === 'admin') {
                        const current = parseInt(badge?.textContent || '0') || 0;
                        showBadge(current + 1);
                        // prepend to dropdown
                        if (dropdown) {
                            const n = payload.notification;
                            const item = document.createElement('div');
                            item.className = 'p-2 border-bottom';
                            item.innerHTML = `<strong>${n.title}</strong><div class="text-muted small">${n.message}</div>`;
                            dropdown.insertBefore(item, dropdown.firstChild);
                        }
                        // prepend to admin notifications list if on page
                        const list = document.querySelector('#admin-notifications-list ul');
                        if (list) {
                            const li = document.createElement('li');
                            li.className = 'list-group-item notif-unread d-flex justify-content-between align-items-start';
                            li.setAttribute('data-id', (payload.notification && payload.notification._id) || '');
                            li.innerHTML = `<div><strong>${payload.notification.title}</strong><div class="text-muted small">${payload.notification.message}</div><div class="text-muted small">${new Date().toLocaleString()}</div></div><div class="text-right"><span class="badge badge-primary mb-2 notif-new">New</span><br><button class="btn btn-sm btn-outline-primary mark-read-btn mb-1">Mark Read</button><button class="btn btn-sm btn-outline-danger delete-notif-btn">Delete</button></div>`;
                            list.insertBefore(li, list.firstChild);
                        }
                        // play sound
                        try{ playNotificationSound(); }catch(e){}
                    }
                } catch (e) { console.error(e); }
            });
        } else {
            if (typeof io === 'undefined') console.warn('Socket.IO client not found; realtime notifications disabled');
        }
    } catch (e) { console.error('Admin socket init error', e); }

    // initial fetch
    fetchCount(); fetchLatest();

    // Auto-mark unread notifications as read when page opens (idempotent)
    (function autoMarkUnread(){
        try{
            const list = document.querySelectorAll('#admin-notifications-list li[data-id]');
            const unreadIds = [];
            list.forEach(li => { if (li.querySelector('.notif-new')) unreadIds.push(li.getAttribute('data-id')); });
            if (unreadIds.length === 0) return;
            // mark each as read (fire-and-forget), update UI
            // Prefer a single API call to mark all as read
            try{
                const reqUrl = '/admin/notifications/read-all';
                console.log('Notification Request', reqUrl);
                console.log('CSRF', csrfToken);
                await fetch(reqUrl, { method: 'POST', credentials: 'include', headers: { 'Content-Type':'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) } });
            }catch(e){ console.error('autoMarkUnread error', e); }
            // UI updates
            document.querySelectorAll('#admin-notifications-list .notif-new').forEach(b=>b.remove());
            document.querySelectorAll('#admin-notifications-list .mark-read-btn').forEach(btn=>{ btn.disabled = true; });
            document.querySelectorAll('#admin-notifications-list li').forEach(li => { li.classList.remove('notification-unread'); li.classList.add('notif-read'); });
            // refresh navbar count
            setTimeout(fetchCount, 300);
        }catch(e){ console.error('autoMarkUnread error', e); }
    })();

    // Play small notification beep using WebAudio
    function playNotificationSound(){
        try{
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.05;
            o.connect(g); g.connect(ctx.destination);
            o.start(); setTimeout(()=>{ o.stop(); ctx.close(); }, 120);
        }catch(e){ /* ignore */ }
    }
})();
