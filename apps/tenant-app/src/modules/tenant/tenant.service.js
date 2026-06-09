const { Application, Property, Tenant, Notification, Invoice, Payment, Lease } = require('../../../../../shared/models')
const Admin = require('../../../../../shared/models').Admin;
const notify = require('../../../../../utils/notify');
const riskAnalysisService = require('../../../../../services/ai/riskAnalysis.service');

const WARNING_THRESHOLD_MS = 1000;
const CRITICAL_THRESHOLD_MS = 5000;

function formatSeverity(duration) {
    if (duration > CRITICAL_THRESHOLD_MS) return 'CRITICAL';
    if (duration > WARNING_THRESHOLD_MS) return 'WARNING';
    return '';
}

async function measureStep(stepName, fn) {
    const start = Date.now();
    const result = await fn();
    const duration = Date.now() - start;
    const severity = formatSeverity(duration);
    console.log(`[ApplyProperty] ${stepName} Completed (${duration}ms)${severity ? ' ' + severity : ''}`);
    return { result, duration, stepName };
}

function createApplyPropertySummary(steps, totalMs) {
    const slowest = steps.slice().sort((a, b) => b.duration - a.duration)[0];
    let rootCause = 'No major delays detected';
    if (slowest) {
        if (slowest.duration > CRITICAL_THRESHOLD_MS) {
            rootCause = `${slowest.stepName} exceeded critical threshold`;
        } else if (slowest.duration > WARNING_THRESHOLD_MS) {
            rootCause = `${slowest.stepName} exceeded warning threshold`;
        }
    }
    const recommendedFix = rootCause.includes('AI')
        ? 'Keep AI scoring asynchronous and investigate AI provider latency.'
        : rootCause.includes('database')
            ? 'Optimize the database query or add indexes for tenant application lookups.'
            : 'Monitor application latency and ensure AI provider timeout protection is in place.';

    console.log(`[ApplyProperty] Summary | total=${totalMs}ms | slowest=${slowest?.stepName || 'none'} (${slowest?.duration || 0}ms) | rootCause=${rootCause} | recommendedFix=${recommendedFix}`);
}

class TenantService {
    /**
     * Submit an application for a property
     * Strictly enforces business rules like "one active lease per tenant"
     */
    async applyForProperty(tenantId, propertyId, applicationData) {
        const requestStart = Date.now();
        const steps = [];
        let application;

        console.log('[ApplyProperty] Start for tenant', tenantId, 'property', propertyId);

        const propertyStep = await measureStep('Property Lookup', () => Property.findById(propertyId));
        steps.push(propertyStep);
        const property = propertyStep.result;

        if (!property || property.status !== 'available') {
            createApplyPropertySummary(steps, Date.now() - requestStart);
            throw new Error('Property is no longer available for applications.');
        }

        const tenantStep = await measureStep('Tenant Lookup', () => Tenant.findById(tenantId));
        steps.push(tenantStep);
        const tenant = tenantStep.result;
        if (!tenant) {
            createApplyPropertySummary(steps, Date.now() - requestStart);
            throw new Error('Your account information could not be found.');
        }

        // RULE: Check for active lease
        const existingLeaseStep = await measureStep('Active Lease Check', () => 
            Lease.findOne({
                tenantId: tenantId,
                status: 'active',
                isDeleted: false
            })
        );
        steps.push(existingLeaseStep);
        if (existingLeaseStep.result) {
            createApplyPropertySummary(steps, Date.now() - requestStart);
            throw new Error('You already have an active lease.');
        }

        // RULE: Check for approved application awaiting deposit payment
        const approvedApplicationStep = await measureStep('Approved Application Check', () =>
            Application.findOne({
                $or: [
                    { applicantId: tenantId },
                    { applicantEmail: tenant.email },
                    { tenantId: tenantId }
                ],
                status: 'approved',
                isDeleted: false
            })
        );
        steps.push(approvedApplicationStep);
        if (approvedApplicationStep.result) {
            createApplyPropertySummary(steps, Date.now() - requestStart);
            throw new Error('You already have a pending property commitment.');
        }

        // RULE: Check for reserved property (tenant linked to property)
        const reservedPropertyStep = await measureStep('Reserved Property Check', () =>
            Property.findOne({
                tenantId: tenantId,
                status: 'leased',
                isDeleted: false
            })
        );
        steps.push(reservedPropertyStep);
        if (reservedPropertyStep.result) {
            createApplyPropertySummary(steps, Date.now() - requestStart);
            throw new Error('You already have a pending property commitment.');
        }

        const existingApplicationStep = await measureStep('Duplicate Application Check', () => Application.findOne({
            applicantId: tenantId,
            propertyId: propertyId,
            isDeleted: false,
            $or: [
                { status: 'pending' },
                { status: 'approved' }
            ]
        }));
        steps.push(existingApplicationStep);
        if (existingApplicationStep.result) {
            createApplyPropertySummary(steps, Date.now() - requestStart);
            throw new Error('You have already applied for this property.');
        }

        const pendingCountStep = await measureStep('Pending Applications Count', () => Application.countDocuments({
            applicantId: tenantId,
            status: 'pending',
            isDeleted: false
        }));
        steps.push(pendingCountStep);
        if (pendingCountStep.result >= 3) {
            createApplyPropertySummary(steps, Date.now() - requestStart);
            throw new Error('You can only have up to 3 pending applications at a time.');
        }

        if (!applicationData.terms) {
            createApplyPropertySummary(steps, Date.now() - requestStart);
            throw new Error('You must accept the lease terms and conditions to submit this application.');
        }

        const moveInDate = new Date(applicationData.preferredMoveIn);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (moveInDate < today) {
            createApplyPropertySummary(steps, Date.now() - requestStart);
            throw new Error('Move-in date must be today or in the future.');
        }

        const minimumIncome = property.rent * 2;
        if (parseInt(applicationData.monthlyIncome) < minimumIncome) {
            createApplyPropertySummary(steps, Date.now() - requestStart);
            throw new Error(`Your monthly income should be at least ₹${minimumIncome} (2x the rent) to qualify.`);
        }

        application = new Application({
            adminId: property.adminId,
            applicantId: tenantId,
            applicantName: applicationData.applicantName,
            applicantEmail: applicationData.applicantEmail,
            phone: applicationData.phone,
            monthlyIncome: parseInt(applicationData.monthlyIncome),
            occupation: applicationData.occupation,
            occupants: parseInt(applicationData.occupants),
            leaseDuration: parseInt(applicationData.leaseDuration),
            preferredMoveIn: moveInDate,
            propertyId: propertyId,
            termsAccepted: true,
            termsAcceptedAt: new Date(),
            termsAcceptedVersion: 'lease-terms-v1',
            status: 'pending',
            aiRiskLevel: 'PENDING',
            aiConfidenceScore: 0,
            aiRecommendation: 'PENDING',
            aiExplanation: 'AI analysis pending'
        });

        const saveStep = await measureStep('Application Save', () => application.save());
        steps.push(saveStep);
        application = saveStep.result;

        this.startBackgroundAiScoring(application, property, tenant).catch(err => console.error('[AI] Error', err));

        const notificationsStart = Date.now();
        Notification.create({
            userType: 'admin',
            adminId: property.adminId,
            title: 'New rental application submitted',
            message: `${applicationData.applicantName} applied for ${property.propertyname}`,
            type: 'application_submitted',
            metadata: {
                tenantId: tenantId,
                propertyId: propertyId,
                applicationId: application._id
            }
        }).catch(err => console.error('Failed to create admin notification:', err.message));

        Notification.create({
            userType: 'tenant',
            tenantId: tenantId,
            title: 'Application submitted',
            message: `Your application for ${property.propertyname} has been submitted successfully and is pending review.`,
            type: 'application_submitted',
            metadata: {
                applicationId: application._id,
                propertyId: propertyId
            }
        }).catch(err => console.error('Failed to create tenant notification:', err.message));
        console.log(`[ApplyProperty] Notifications dispatch completed (${Date.now() - notificationsStart}ms)`);

        const adminLookupStep = await measureStep('Admin Lookup', () => Admin.findById(property.adminId).lean());
        steps.push(adminLookupStep);
        const admin = adminLookupStep.result;
        const appUrl = process.env.APP_URL || 'http://localhost:3000';

        if (admin?.email) {
            notify.sendMail({
                to: admin.email,
                subject: `New application for ${property.propertyname}`,
                text: `${applicationData.applicantName} (${applicationData.applicantEmail}) applied for ${property.propertyname}. Review it at ${appUrl}/admin/applications`,
                html: `<p>Hello ${admin.username || 'Admin'},</p>
                       <p>A new application has been submitted by <strong>${applicationData.applicantName}</strong> for <strong>${property.propertyname}</strong>.</p>
                       <p><strong>Email:</strong> ${applicationData.applicantEmail}</p>
                       <p><strong>Phone:</strong> ${applicationData.phone}</p>
                       <p>Review the application here: <a href="${appUrl}/admin/applications">Admin Applications</a></p>`
            }).catch(err => console.error('Failed to send admin application email:', err.message));
        }

        notify.sendMail({
            to: tenant.email,
            subject: `Your application for ${property.propertyname} is pending review`,
            text: `Your application for ${property.propertyname} has been submitted successfully and is pending review by the administrator.`,
            html: `<p>Hi ${tenant.firstname || 'Tenant'},</p>
                   <p>Your application for <strong>${property.propertyname}</strong> has been submitted successfully.</p>
                   <p>We will notify you when the admin reviews your application.</p>
                   <p>You can check the status at <a href="${appUrl}/tenant/applications">My Applications</a>.</p>`
        }).catch(err => console.error('Failed to send tenant application email:', err.message));

        createApplyPropertySummary(steps, Date.now() - requestStart);
        return application;
    }

    async startBackgroundAiScoring(application, property, tenant) {
        const start = Date.now();
        const appId = application._id.toString();
        console.log(`[AI] Analysis Started | Application: ${appId}`);

        try {
            const previousLatePayments = tenant && tenant._id
                ? await Invoice.countDocuments({
                    tenantId: tenant._id,
                    status: 'overdue',
                    isDeleted: false
                })
                : 0;
            const applicationHistoryCount = tenant && tenant._id
                ? await Application.countDocuments({
                    applicantId: tenant._id,
                    isDeleted: false
                })
                : 0;

            const aiResult = await riskAnalysisService.analyzeTenantRisk({
                monthlyIncome: application.monthlyIncome,
                propertyRent: property.rent,
                occupation: application.occupation || 'Unknown',
                leaseDuration: application.leaseDuration,
                previousLatePayments,
                applicationHistoryCount,
                rentToIncomeRatio: Number((property.rent / Math.max(application.monthlyIncome, 1)).toFixed(2))
            });

            const safeRiskLevel = ['LOW', 'MEDIUM', 'HIGH'].includes(String(aiResult?.riskLevel || '').toUpperCase())
                ? String(aiResult.riskLevel).toUpperCase()
                : 'UNKNOWN';
            const safeRecommendation = ['APPROVE', 'REVIEW', 'REJECT'].includes(String(aiResult?.recommendation || '').toUpperCase())
                ? String(aiResult.recommendation).toUpperCase()
                : 'MANUAL_REVIEW';
            const safeConfidence = Number.isFinite(Number(aiResult?.confidenceScore)) ? Number(aiResult.confidenceScore) : 0;

            console.log('[AI-RERUN] Analysis Complete', { applicationId: appId, riskLevel: safeRiskLevel, confidence: safeConfidence });
            console.log('[AI] Response Received', { applicationId: appId, riskLevel: safeRiskLevel, confidence: safeConfidence });

            application.aiRiskLevel = safeRiskLevel;
            application.aiConfidenceScore = safeConfidence;
            application.aiRecommendation = safeRecommendation;
            application.aiExplanation = String(aiResult?.explanation || 'AI analysis completed.');
            application.aiRiskFactors = Array.isArray(aiResult?.riskFactors) ? aiResult.riskFactors : [];
            application.aiStrengths = Array.isArray(aiResult?.strengths) ? aiResult.strengths : [];
            application.aiWeaknesses = Array.isArray(aiResult?.weaknesses) ? aiResult.weaknesses : [];
            application.aiDecisionReason = String(aiResult?.decisionReason || aiResult?.explanation || 'AI analysis completed.');
            application.aiGeneratedAt = new Date();
            await application.save();

            console.log('[AI] MongoDB Updated', { applicationId: appId, durationMs: Date.now() - start });
        } catch (err) {
            console.error('[AI] Error', { applicationId: appId, message: err.message, durationMs: Date.now() - start });

            try {
                application.aiRiskLevel = 'UNKNOWN';
                application.aiRecommendation = 'MANUAL_REVIEW';
                application.aiConfidenceScore = 0;
                application.aiExplanation = `AI analysis failed: ${err.message}`;
                application.aiRiskFactors = [];
                application.aiStrengths = [];
                application.aiWeaknesses = [];
                application.aiDecisionReason = 'AI analysis failed; manual review required.';
                application.aiGeneratedAt = new Date();
                await application.save();
                console.log('[AI] MongoDB Updated', { applicationId: appId, fallback: true });
            } catch (saveErr) {
                console.error('[AI] Error', { applicationId: appId, message: saveErr.message, fallback: true });
            }
        }
    }
}

module.exports = new TenantService();
