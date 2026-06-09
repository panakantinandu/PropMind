const aiService = require('./ai/ai.service');
const { Tenant, Invoice, Payment, Lease, Ticket, Application, Property, SupportTicket } = require('../shared/models');

function safeDate(d) {
    try { return d ? new Date(d).toString() : null; } catch(e){ return null; }
}

function parseModelJson(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const text = raw.replace(/^JSON\s*:\s*/i, '').trim();
    try {
        return JSON.parse(text);
    } catch (e) {
        try {
            const match = text.match(/\{[\s\S]*\}/);
            if (!match) return null;
            return Function(`return (${match[0]});`)();
        } catch (inner) {
            return null;
        }
    }
}

async function aiAssistTenant(tenantId, question) {
    // Gather facts
    const tenant = await Tenant.findById(tenantId).populate('propertyId').lean();
    const upcomingInvoice = await Invoice.findOne({ tenantId, status: { $in: ['unpaid','overdue','partial'] }, isDeleted: false }).sort({ dueDate: 1 }).lean();
    const recentPayments = await Payment.find({ tenantId, status: 'approved', isDeleted: false }).sort({ createdAt: -1 }).limit(5).lean();
    const activeLease = await Lease.findOne({ tenantId, status: 'active', isDeleted: false }).lean();
    const recentTickets = await SupportTicket.find({ tenantId, isDeleted: false }).sort({ createdAt: -1 }).limit(3).lean();

    const facts = {
        tenant: { id: tenant?._id, name: tenant ? `${tenant.firstname || ''} ${tenant.lastname || ''}`.trim() : null, email: tenant?.email, property: tenant?.propertyId?.propertyname },
        upcomingInvoice: upcomingInvoice ? { id: upcomingInvoice._id, dueDate: safeDate(upcomingInvoice.dueDate), amount: upcomingInvoice.totalAmount, status: upcomingInvoice.status } : null,
        recentPayments: recentPayments.map(p => ({ date: safeDate(p.createdAt), amount: p.amountPaid, method: p.paymentMethod })),
        activeLease: activeLease ? { start: safeDate(activeLease.leaseStartDate || activeLease.startDate), end: safeDate(activeLease.leaseEndDate || activeLease.endDate), rent: activeLease.rent } : null,
        recentTickets: recentTickets.map(t => ({ id: t._id, subject: t.subject || t.title, status: t.status }))
    };

    try { console.log('[SUPPORT] aiAssistTenant facts', { tenantId, upcomingInvoice: !!facts.upcomingInvoice, recentPayments: facts.recentPayments.length, activeLease: !!facts.activeLease, recentTickets: facts.recentTickets.length }); } catch(e){}

    const system = `You are a tenant support assistant. Use ONLY the facts supplied to answer. If you cannot answer, return JSON: { action: 'create_ticket', title: '...', description: '...' }. Otherwise return JSON: { action: 'answer', answer: '...', confidence: 0-100 }`;
    const user = `Question: ${question}\nFacts: ${JSON.stringify(facts)}`;

    try {
        const aiRes = await aiService.createChatCompletion([
            { role: 'system', content: system },
            { role: 'user', content: user }
        ], { maxTokens: 300 });
        const txt = aiRes && aiRes.choices && aiRes.choices[0] && aiRes.choices[0].message ? aiRes.choices[0].message.content : '';
        const parsed = parseModelJson(txt);
        return { success: true, raw: txt, parsed };
    } catch (err) {
        // Fallback rule-based
        const q = (question || '').toLowerCase();
        if (q.includes('when is my rent') || q.includes('when is rent') || q.includes('due')) {
            if (facts.upcomingInvoice) return { success: true, parsed: { action: 'answer', answer: `Your next due invoice is ${facts.upcomingInvoice.amount} due on ${facts.upcomingInvoice.dueDate}`, confidence: 90 } };
            return { success: true, parsed: { action: 'answer', answer: 'No upcoming unpaid invoice found in our records.', confidence: 60 } };
        }
        if (q.includes('payment failed') || q.includes('failed')) {
            return { success: true, parsed: { action: 'answer', answer: 'If your payment failed, please check your payment method and try again. If it persists, create a support ticket and include the transaction reference.', confidence: 70 } };
        }
        if (q.includes('why was my application rejected') || q.includes('application rejected')) {
            const app = await Application.findOne({ applicantEmail: tenant?.email }).sort({ createdAt: -1 }).lean();
            const reason = app ? (app.adminComments || app.aiExplanation || 'No specific reason recorded.') : 'No related application found.';
            return { success: true, parsed: { action: 'answer', answer: `Latest application status: ${app?.status || 'unknown'}. Reason: ${reason}`, confidence: 75 } };
        }

        return { success: true, parsed: { action: 'create_ticket', title: `Assistance required: ${question.substring(0,80)}`, description: `Tenant asked: ${question}\nFacts: ${JSON.stringify(facts)}` } };
    }
}

async function aiAssistAdmin(adminId, question) {
    // Gather admin-level facts
    const highRisk = await Application.countDocuments({ adminId, aiRiskLevel: 'HIGH', isDeleted: false });
    const unpaid = await Invoice.countDocuments({ adminId, status: { $in: ['unpaid','overdue','partial'] }, isDeleted: false });
    const maintenanceCount = await Ticket.countDocuments({ adminId, isDeleted: false });
    const paymentsAgg = await Payment.aggregate([{ $match: { adminId, status: 'approved', isDeleted: false } }, { $group: { _id: null, totalReceived: { $sum: '$amountPaid' } } }]);
    const totalReceived = paymentsAgg[0] ? Number(paymentsAgg[0].totalReceived) : 0;

    const facts = { highRiskApplicants: highRisk, unpaidInvoices: unpaid, maintenanceTickets: maintenanceCount, totalReceived };

    const system = `You are an admin analytics assistant. Use ONLY the facts provided. When asked for lists (eg unpaid invoices), include counts and examples. Respond in JSON: { action: 'answer', answer: '...', suggestions: [...] }`;
    const user = `Question: ${question}\nFacts: ${JSON.stringify(facts)}`;

    try {
        const aiRes = await aiService.createChatCompletion([
            { role: 'system', content: system },
            { role: 'user', content: user }
        ], { maxTokens: 400 });
        const txt = aiRes && aiRes.choices && aiRes.choices[0] && aiRes.choices[0].message ? aiRes.choices[0].message.content : '';
        const parsed = parseModelJson(txt);
        return { success: true, raw: txt, parsed };
    } catch (err) {
        const q = (question || '').toLowerCase();
        if (q.includes('unpaid invoices') || q.includes('show unpaid invoices')) {
            // return top 5 unpaid invoice examples
            const ex = await Invoice.find({ adminId, status: { $in: ['unpaid','overdue','partial'] }, isDeleted: false }).sort({ dueDate: 1 }).limit(5).lean();
            return { success: true, parsed: { action: 'answer', answer: `There are ${unpaid} unpaid invoices. Examples: ${ex.map(i=>`${i._id} due ${safeDate(i.dueDate)} amount ${i.totalAmount}`).join(' ; ')}`, suggestions: ['Contact tenants','Offer payment plans'] } };
        }
        if (q.includes('maintenance trends') || q.includes('maintenance')) {
            return { success: true, parsed: { action: 'answer', answer: `There are ${maintenanceCount} open maintenance tickets. Look into top properties by ticket volume.`, suggestions: ['Run maintenance backlog report','Prioritize urgent tickets'] } };
        }
        return { success: true, parsed: { action: 'answer', answer: 'I could not complete the AI query; please try a simpler question or check AI configuration.', suggestions: [] } };
    }
}

module.exports = { aiAssistTenant, aiAssistAdmin };
