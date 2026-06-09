document.addEventListener('DOMContentLoaded', () => {
    console.log('[SUPPORT] 🚀 DOM ready - page loaded');
    const adminId = window.ADMIN_ID || document.body.dataset.adminId;
    console.log('[SUPPORT] adminId from window/body:', adminId);

    // Initialize Socket.IO defensively
    let socket = null;
    if (typeof io !== 'undefined' && adminId) {
        try {
            socket = io({ query: { adminId } });
            console.log('[SUPPORT] ✅ Socket initialized for adminId:', adminId);
        } catch (e) { 
            console.error('[SUPPORT] ❌ Socket init error', e); 
        }
    } else {
        console.warn('[SUPPORT] ⚠️  Socket.IO client not present or adminId missing; realtime disabled. io=' + (typeof io) + ' adminId=' + adminId);
    }

    // Utility: extract CSRF token and log it
    function getCSRFToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        const token = meta ? meta.getAttribute('content') : null;
        console.log('[SUPPORT] 🔐 CSRF token extracted:', token ? token.substring(0,10) + '...' : 'NOT FOUND');
        return token;
    }

    // Utility: make AJAX requests with detailed logging
    async function makeRequest(url, options = {}) {
        const method = options.method || 'GET';
        console.log(`[SUPPORT] 📤 REQUEST START: ${method} ${url}`);
        console.log(`[SUPPORT] 📋 Request headers:`, options.headers);
        
        try {
            const response = await fetch(url, options);
            console.log(`[SUPPORT] 📥 RESPONSE: status=${response.status} ${response.statusText}`);
            
            const text = await response.text();
            let json;
            try {
                json = JSON.parse(text);
                console.log(`[SUPPORT] ✅ Response JSON:`, JSON.stringify(json).substring(0, 200));
            } catch (e) {
                console.log(`[SUPPORT] ⚠️  Response not JSON, raw text length:`, text.length);
                json = { raw: text };
            }
            
            return { status: response.status, json, ok: response.ok };
        } catch (err) {
            console.error(`[SUPPORT] ❌ Fetch error:`, err.message);
            throw err;
        }
    }

    // Quick actions / AI assistant
    const qaButtons = document.querySelectorAll('#admin-quick-actions .qa') || [];
    console.log(`[SUPPORT] Found ${qaButtons.length} quick action buttons`);
    
    const output = document.getElementById('admin-ai-output');
    const answerBox = document.getElementById('admin-ai-answer');
    const chatForm = document.getElementById('admin-chat-form');
    function renderInsightCard(title, message) {
        if (!output) return;
        output.innerHTML = `
          <div class="card border-0 shadow-sm">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                  <div class="text-uppercase small text-primary font-weight-bold">AI Operations</div>
                  <h6 class="mb-1">${title}</h6>
                </div>
                <span class="badge badge-success">Ready</span>
              </div>
              <p class="mb-0 text-muted">${message}</p>
            </div>
          </div>`;
    }
    const chatInput = document.getElementById('admin-chat-input');
    
    console.log('[SUPPORT] DOM elements found:', { 
        qaButtonsCount: qaButtons.length, 
        output: !!output, 
        answerBox: !!answerBox, 
        chatForm: !!chatForm, 
        chatInput: !!chatInput 
    });

    qaButtons.forEach((btn, idx) => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            console.log(`[SUPPORT] 🔘 QUICK ACTION CLICKED (#${idx}): ${action}`);
            
            if (output) output.innerText = 'Loading...';
            try {
                const csrf = getCSRFToken();
                const url = '/admin/support/insight/' + encodeURIComponent(action);
                
                const { status, json } = await makeRequest(url, { 
                    credentials: 'include', 
                    headers: { 
                        'Accept': 'application/json', 
                        'X-Requested-With': 'XMLHttpRequest', 
                        ...(csrf ? { 'X-CSRF-Token': csrf } : {}) 
                    } 
                });
                
                if (status !== 200 || !json || !json.success) {
                    console.error(`[SUPPORT] ❌ Quick action failed: status=${status} success=${json?.success}`);
                    if (output) output.innerText = 'Insight failed: ' + (json?.message || 'Unknown error');
                    return;
                }
                
                console.log(`[SUPPORT] ✅ Quick action success, rendering output`);
                const text = json?.result?.parsed?.answer || json?.message || 'Your ops summary is ready.';
                renderInsightCard('AI Insight', text);
            } catch (e) { 
                console.error(`[SUPPORT] ❌ Exception in quick action:`, e); 
                if (output) output.innerText = 'Failed: ' + e.message; 
            }
        });
    });

    if (chatForm) {
        console.log('[SUPPORT] Chat form found, attaching submit listener');
        chatForm.addEventListener('submit', async (e)=>{
            e.preventDefault();
            const q = chatInput?.value.trim();
            console.log('[SUPPORT] 💬 CHAT SUBMIT: question="' + q + '"');
            
            if(!q) {
                console.warn('[SUPPORT] ⚠️  Empty question');
                return;
            }
            
            if (answerBox) answerBox.innerText = 'Thinking...';
            try {
                const csrf = getCSRFToken();
                const { status, json } = await makeRequest('/admin/support/ask', { 
                    method: 'POST', 
                    credentials: 'include', 
                    headers: {
                        'Content-Type':'application/json', 
                        'Accept': 'application/json', 
                        'X-Requested-With': 'XMLHttpRequest', 
                        ...(csrf ? { 'X-CSRF-Token': csrf } : {}) 
                    }, 
                    body: JSON.stringify({ question: q }) 
                });
                
                if (status !== 200 || !json?.success) {
                    console.error(`[SUPPORT] ❌ Chat failed: status=${status}`);
                    if (answerBox) answerBox.innerHTML = '<pre>Error: ' + (json?.message || 'Unknown error') + '</pre>';
                    return;
                }
                
                console.log(`[SUPPORT] ✅ Chat success`);
                const text = json?.result?.parsed?.answer || json?.message || 'Your question is ready.';
                if (answerBox) answerBox.innerHTML = `<div class="card border-0 shadow-sm"><div class="card-body"><strong>Answer</strong><p class="mb-0 text-muted">${text}</p></div></div>`;
                if (chatInput) chatInput.value = '';
            } catch (e) { 
                console.error(`[SUPPORT] ❌ Exception in chat:`, e); 
                if (answerBox) answerBox.innerText = 'AI request failed: ' + e.message; 
            }
        });
    }

    // Real-time activity feed
    const liveFeed = document.getElementById('admin-live-feed');
    console.log('[SUPPORT] Live feed element:', !!liveFeed);
    
    function appendFeed(type, text){
        if (!liveFeed) return;
        const el = document.createElement('div'); 
        el.className = 'mb-2';
        el.innerHTML = `<div class="small text-muted">${new Date().toLocaleTimeString()} • <strong>${type}</strong> — ${text}</div>`;
        liveFeed.insertBefore(el, liveFeed.firstChild);
        console.log(`[SUPPORT] 📢 Feed updated: ${type} - ${text}`);
    }
    
    if (socket) {
        console.log('[SUPPORT] Attaching socket event listeners');
        socket.on('support:ticket:new', (data)=>{ try { appendFeed('Ticket', data.subject || data.title || 'New support ticket'); } catch(e){console.error(e);} });
        socket.on('payment:new', (data)=>{ try { appendFeed('Payment', data.title || (`$${data.amountPaid||''} by ${data.tenantId||''}`)); } catch(e){console.error(e);} });
        socket.on('application:new', (data)=>{ try { appendFeed('Application', data.title || (`Application ${data._id||''}`)); } catch(e){console.error(e);} });
        socket.on('maintenance:request:new', (data)=>{ try { appendFeed('Maintenance', data.title || (data.subject||'Maintenance request')); } catch(e){console.error(e);} });
        socket.on('lease:expiring', (data)=>{ try { appendFeed('Lease', data._id ? `Lease ${data._id} expiring` : 'Lease expiring'); } catch(e){console.error(e);} });
        socket.on('notification:new', (data)=>{ try { appendFeed('Notification', data.notification && (data.notification.title || data.notification.message) || 'New notification'); } catch(e){console.error(e);} });
    }

    // Load initial notifications for live feed
    (async function loadInitialNotifications(){
        try{
            console.log('[SUPPORT] 📋 Loading initial notifications for live feed');
            const resp = await fetch('/admin/notifications/recent', { 
                credentials: 'include', 
                headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } 
            });
            console.log('[SUPPORT] Initial notifications response status:', resp.status);
            const json = await resp.json();
            if (json && json.notifications && Array.isArray(json.notifications)){
                console.log(`[SUPPORT] ✅ Loaded ${json.notifications.length} initial notifications`);
                json.notifications.slice(0,10).forEach(n => appendFeed('Notification', n.title || n.message || 'Notification'));
            } else {
                console.warn('[SUPPORT] ⚠️  No notifications in response:', json);
            }
        }catch(e){ console.error('[SUPPORT] ❌ loadInitialNotifications failed', e); }
    })();

    // Category buttons - MAIN HANDLER
    console.log('[SUPPORT] Hooking category buttons');
    const categoryButtons = document.querySelectorAll('.category-btn');
    console.log(`[SUPPORT] Found ${categoryButtons.length} category buttons`);
    
    categoryButtons.forEach((btn, idx) => {
        btn.addEventListener('click', async (e)=>{ 
            e.preventDefault(); 
            const cat = btn.dataset.category;
            console.log(`[SUPPORT] 🎯 CATEGORY BUTTON CLICKED (#${idx}): ${cat}`);
            
            const results = document.getElementById('category-results');
            if (!results) {
                console.error('[SUPPORT] ❌ category-results element not found');
                return;
            }
            
            if (!cat) {
                console.error('[SUPPORT] ❌ No category in data-category attribute');
                return;
            }
            
            // For operations categories, fetch structured JSON
            const ops = ['payments','applications','maintenance','leases','revenue','tenants'];
            if (!ops.includes(cat)) {
                console.warn(`[SUPPORT] ⚠️  Category "${cat}" not in operations list`);
                return;
            }
            
            try {
                if (results) results.innerHTML = '<div class="text-muted">Loading category: ' + cat + '...</div>';
                
                const csrf = getCSRFToken();
                const url = '/admin/support/data/' + encodeURIComponent(cat) + '?page=1&limit=25';
                console.log(`[SUPPORT] 📡 Fetching category data from: ${url}`);
                
                const { status, json } = await makeRequest(url, { 
                    credentials: 'include', 
                    headers: { 
                        'Accept': 'application/json', 
                        'X-Requested-With': 'XMLHttpRequest', 
                        ...(csrf ? { 'X-CSRF-Token': csrf } : {}) 
                    } 
                });
                
                if (!json || !json.success) {
                    console.error(`[SUPPORT] ❌ Failed to load category ${cat}:`, json);
                    if (results) results.innerHTML = '<div class="text-danger">Failed to load ' + cat + ': ' + (json?.message || 'Unknown error') + '</div>';
                    return;
                }
                
                console.log(`[SUPPORT] ✅ Successfully loaded category ${cat}, rendering...`);
                
                // Render simple cards for each category
                const container = document.createElement('div');
                if (cat === 'payments') {
                    console.log(`[SUPPORT] 💰 Rendering payments: total=${json.total} outstanding=${json.totalOutstanding}`);
                    container.innerHTML = `<div class="mb-2"><strong>Overdue invoices:</strong> ${json.total || 0} • <strong>Total outstanding:</strong> $${json.totalOutstanding || 0}</div>`;
                    const ul = document.createElement('ul'); 
                    ul.className = 'list-group';
                    (json.items||[]).slice(0,50).forEach(i=>{ 
                        const li=document.createElement('li'); 
                        li.className='list-group-item'; 
                        li.innerHTML=`<div><strong>${i._id}</strong> — ${i.tenantId||''} • ${i.status||''} • $${i.totalAmount||''} • due ${i.dueDate ? new Date(i.dueDate).toLocaleDateString() : 'N/A'}</div>`; 
                        ul.appendChild(li); 
                    });
                    container.appendChild(ul);
                } else if (cat === 'applications') {
                    console.log(`[SUPPORT] 📋 Rendering applications: pending=${json.totalPending} highRisk=${json.totalHigh}`);
                    container.innerHTML = `<div class="mb-2"><strong>Pending:</strong> ${json.totalPending || 0} • <strong>High risk:</strong> ${json.totalHigh || 0}</div>`;
                    const p = document.createElement('div'); 
                    p.className='mb-2'; 
                    p.innerHTML = '<strong>AI Recommendations</strong><pre>' + JSON.stringify(json.ai||{}, null, 2) + '</pre>'; 
                    container.appendChild(p);
                    const ul = document.createElement('ul'); 
                    ul.className='list-group'; 
                    (json.pending||[]).slice(0,50).forEach(a=>{ 
                        const li=document.createElement('li'); 
                        li.className='list-group-item'; 
                        li.innerHTML=`<div><strong>${a._id}</strong> • ${a.applicantEmail||''} • ${a.aiRiskLevel||''} • ${a.propertyId ? a.propertyId.propertyname : 'N/A'}</div>`; 
                        ul.appendChild(li); 
                    }); 
                    container.appendChild(ul);
                } else if (cat === 'maintenance') {
                    console.log(`[SUPPORT] 🔧 Rendering maintenance: open=${json.totalOpen} urgent=${json.totalUrgent}`);
                    container.innerHTML = `<div class="mb-2"><strong>Open:</strong> ${json.totalOpen || 0} • <strong>Urgent:</strong> ${json.totalUrgent || 0} • <strong>Avg response (hrs):</strong> ${json.avgResponseHours || 'N/A'}</div>`;
                    const ul = document.createElement('ul'); 
                    ul.className='list-group'; 
                    (json.open||[]).slice(0,50).forEach(t=>{ 
                        const li=document.createElement('li'); 
                        li.className='list-group-item'; 
                        li.innerHTML=`<div><strong>${t._id}</strong> • ${t.subject||t.title||''} • ${t.status||''} • priority: ${t.priority||'N/A'}</div>`; 
                        ul.appendChild(li); 
                    }); 
                    container.appendChild(ul);
                } else if (cat === 'leases') {
                    console.log(`[SUPPORT] 📆 Rendering leases: 30=${json.counts?.in30} 60=${json.counts?.in60} 90=${json.counts?.in90}`);
                    container.innerHTML = `<div class="mb-2"><strong>Expiring in 30 days:</strong> ${json.counts?.in30||0} • 60 days: ${json.counts?.in60||0} • 90 days: ${json.counts?.in90||0}</div>`;
                } else if (cat === 'revenue') {
                    console.log(`[SUPPORT] 💵 Rendering revenue: monthly=${json.monthlyRevenue} occupancy=${json.occupancyRate}%`);
                    container.innerHTML = `<div class="mb-2"><strong>Monthly revenue:</strong> $${json.monthlyRevenue || 0} • <strong>Occupancy:</strong> ${json.occupancyRate}% • <strong>Collection:</strong> ${json.collectionRate}%</div>`;
                } else if (cat === 'tenants') {
                    console.log(`[SUPPORT] 👥 Rendering tenants: active=${json.activeTenants} overdue=${json.overdueTenants} repeatLate=${json.repeatLatePayers}`);
                    container.innerHTML = `<div class="mb-2"><strong>Active tenants:</strong> ${json.activeTenants} • <strong>Overdue tenants:</strong> ${json.overdueTenants} • <strong>Repeat late payers:</strong> ${json.repeatLatePayers}</div>`;
                }
                
                console.log(`[SUPPORT] 🎨 DOM update: appending container to results`);
                if (results) { 
                    results.innerHTML = ''; 
                    results.appendChild(container); 
                }
                console.log(`[SUPPORT] ✅ Category ${cat} rendered successfully`);
            } catch (e) { 
                console.error(`[SUPPORT] ❌ Exception in category handler:`, e); 
                if (results) results.innerHTML = '<div class="text-danger">Error loading ' + cat + ': ' + e.message + '</div>'; 
            }
        });
    });
    
    console.log('[SUPPORT] ✅ Support Center fully initialized and ready');
});

