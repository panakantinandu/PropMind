document.addEventListener('DOMContentLoaded', () => {
    console.log('[SUPPORT] DOM ready');
    const tenantId = window.TENANT_ID || document.body.dataset.tenantId;
    const actionCards = document.querySelectorAll('.action-card') || [];
    const guidedContent = document.getElementById('guided-content');
    const chatContainer = document.getElementById('chat-container');
    const messagesEl = document.getElementById('messages');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');

    function getCSRFToken(){
        return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    }

    function showGuided(text, suggestions = []){
        if (!guidedContent) return;
        guidedContent.innerHTML = `<div class="text-muted">${text}</div>`;
        if (suggestions.length) {
            const row = document.createElement('div'); row.className = 'mt-3';
            suggestions.forEach((s) => {
                const btn = document.createElement('button');
                btn.className = 'btn btn-sm btn-outline-primary mr-2 mb-2';
                btn.textContent = s;
                btn.addEventListener('click', () => {
                    if (chatInput) chatInput.value = s;
                    openChat();
                    if (chatForm) chatForm.requestSubmit();
                });
                row.appendChild(btn);
            });
            guidedContent.appendChild(row);
        }
    }

    function openChat(){ if (chatContainer) chatContainer.style.display = 'block'; }

    function appendActionButtons(container, actions = []) {
        if (!container || !actions.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'mt-3 d-flex flex-wrap gap-2';

        actions.forEach((action) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = action.className || 'btn btn-outline-primary btn-sm';
            btn.textContent = action.label || 'Open';

            if (action.href) {
                btn.addEventListener('click', () => {
                    window.location.assign(action.href);
                });
            } else if (typeof action.onClick === 'function') {
                btn.addEventListener('click', action.onClick);
            }

            wrap.appendChild(btn);
        });

        container.appendChild(wrap);
    }

    function renderSupportCard(title, bodyHtml, actions = []) {
        if (!messagesEl) return;
        messagesEl.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'card shadow-sm border-0';
        const body = document.createElement('div');
        body.className = 'card-body';

        body.innerHTML = `
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div>
              <div class="text-uppercase small text-primary font-weight-bold">Support</div>
              <h5 class="mb-1">${title}</h5>
            </div>
            <span class="badge badge-success">Live</span>
          </div>
          <div class="text-muted small mb-3">Your account details are pulled directly from your lease and payment records.</div>`;

        const content = document.createElement('div');
        content.innerHTML = bodyHtml;
        body.appendChild(content);

        appendActionButtons(body, actions);
        card.appendChild(body);
        messagesEl.appendChild(card);
        openChat();
    }

    function renderAiResponse(resp, fallbackTitle = 'AI Support Snapshot') {
        const parsed = resp?.result?.parsed || {};
        const answer = parsed.answer || (typeof resp?.result?.raw === 'string' ? resp.result.raw : '');
        if (parsed.action === 'answer' && answer) {
            const bullets = answer.split('\n').filter(Boolean).map((line) => `<li class="mb-1">${line}</li>`).join('');
            renderSupportCard(fallbackTitle, `<ul class="pl-3 mb-0">${bullets}</ul>`, [
                { label: 'View Payments', href: '/tenant/payments', className: 'btn btn-outline-primary btn-sm' }
            ]);
            return;
        }
        if (parsed.action === 'create_ticket') {
            renderSupportCard('Need Human Help?', `<p class="mb-0">We can create a support ticket for: ${parsed.title || 'your request'}.</p>`, []);
            return;
        }
        renderSupportCard('Support Update', '<p class="mb-0">Your request is being reviewed.</p>', []);
    }

    async function askSupport(question, title = 'Support update') {
        const csrf = getCSRFToken();
        const res = await fetch('/tenant/support/ask', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                ...(csrf ? { 'X-CSRF-Token': csrf } : {})
            },
            body: JSON.stringify({ question })
        });
        const body = await res.json();
        if (!res.ok || !body?.success) throw new Error(body?.message || 'Support request failed');
        renderAiResponse(body, title);
        return body;
    }

    actionCards.forEach((btn) => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            if (action === 'pay_rent') {
                showGuided('We found your next rent payment details. Review them below.', ['When is my rent due?', 'How much do I owe?']);
                try { await askSupport('When is my rent due?', 'Rent Information'); } catch (e) { renderSupportCard('Rent Information', `<p class="text-danger mb-0">${e.message}</p>`, []); }
                return;
            }
            if (action === 'booking_deposit') {
                showGuided('Booking deposit details are available instantly.', ['What is my deposit status?']);
                try { await askSupport('What is my booking deposit status?', 'Booking Deposit'); } catch (e) { renderSupportCard('Booking Deposit', `<p class="text-danger mb-0">${e.message}</p>`, []); }
                return;
            }
            if (action === 'application_status') {
                showGuided('Your latest application record is ready.', ['What is my application status?']);
                try { await askSupport('What is my application status?', 'Application Status'); } catch (e) { renderSupportCard('Application Status', `<p class="text-danger mb-0">${e.message}</p>`, []); }
                return;
            }
            if (action === 'lease_questions') {
                showGuided('Lease details and next steps are shown here.', ['What are my lease terms?']);
                try { await askSupport('What are my lease terms?', 'Lease Questions'); } catch (e) { renderSupportCard('Lease Questions', `<p class="text-danger mb-0">${e.message}</p>`, []); }
                return;
            }
            if (action === 'maintenance') {
                const issue = window.prompt('Describe the maintenance issue briefly (for example: “My sink is leaking”).');
                if (!issue) return;
                showGuided('We are classifying your issue and preparing the right next step.', []);
                try {
                    await askSupport(`I need help with this maintenance issue: ${issue}`, 'Maintenance Support');
                } catch (e) { renderSupportCard('Maintenance Support', `<p class="text-danger mb-0">${e.message}</p>`, []); }
                return;
            }
            if (action === 'payments_refunds') {
                showGuided('We can summarize your payments and refunds.', ['What are my recent payments?']);
                try { await askSupport('What are my recent payments and refunds?', 'Payments & Refunds'); } catch (e) { renderSupportCard('Payments & Refunds', `<p class="text-danger mb-0">${e.message}</p>`, []); }
                return;
            }
            if (action === 'speak_support') {
                const subject = window.prompt('Brief summary of your request');
                const message = window.prompt('Describe what you need help with');
                if (!subject || !message) return;
                const csrf = getCSRFToken();
                const res = await fetch('/tenant/support/tickets', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        ...(csrf ? { 'X-CSRF-Token': csrf } : {})
                    },
                    body: JSON.stringify({ subject, category: 'support', message })
                });
                const data = await res.json();
                if (res.ok && data?.success) {
                    renderSupportCard('Support Ticket Created', `<p class="mb-0">A support ticket has been created for your request.</p>`, []);
                } else {
                    renderSupportCard('Support Ticket', `<p class="text-danger mb-0">We could not create your ticket right now.</p>`, []);
                }
            }
        });
    });

    chatForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const q = chatInput?.value.trim();
        if (!q) return;
        try {
            const csrf = getCSRFToken();
            const res = await fetch('/tenant/support/ask', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    ...(csrf ? { 'X-CSRF-Token': csrf } : {})
                },
                body: JSON.stringify({ question: q })
            });
            const body = await res.json();
            if (!res.ok || !body?.success) throw new Error(body?.message || 'Support request failed');
            renderAiResponse(body);
        } catch (e) {
            renderSupportCard('Support Update', `<p class="text-danger mb-0">${e.message}</p>`, []);
        }
    });
});
