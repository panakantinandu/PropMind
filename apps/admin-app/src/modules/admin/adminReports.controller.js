// Admin Reports Controller
const { Tenant, Property, Application, Invoice, Payment } = require('../../../../../shared/models');

// GET /admin/reports
// Read-only executive summary across properties, tenants, and finances
exports.getReports = async (req, res) => {
    try {
        const now = new Date();

        // Run all aggregations in parallel for performance
        const [
            propertyStatusAgg,
            tenantAgg,
            overdueTenantAgg,
            financialAgg,
            outstandingAgg,
            applicationStatusAgg
        ] = await Promise.all([
            // Property overview by status
            Property.aggregate([
                { $match: { adminId: req.session.adminId,  isDeleted: false } },
                { $group: { _id: { $ifNull: ['$status', 'unknown'] }, count: { $sum: 1 } } }
            ]),

            // Tenant overview: total vs active (has propertyId)
            Tenant.aggregate([
                { $match: { adminId: req.session.adminId,  isDeleted: false } },
                {
                    $group: {
                        _id: null,
                        totalTenants: { $sum: 1 },
                        activeTenants: {
                            $sum: {
                                $cond: [
                                    { $ifNull: ['$propertyId', false] },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ]),

            // Tenants with at least one overdue rent invoice (monthly_rent / rent)
            Invoice.aggregate([
                { $match: { adminId: req.session.adminId, 
                        isDeleted: false,
                        $and: [
                            { $or: [{ type: 'monthly_rent' }, { type: 'rent' }] },
                            { $or: [{ status: 'unpaid' }, { status: 'partial' }, { status: 'overdue' }] },
                            { dueDate: { $lt: now } }
                        ]
                    }
                },
                { $group: { _id: '$tenantId' } },
                { $count: 'tenantsWithOverdueRent' }
            ]),

            // Financial collections broken down by invoice type
            Payment.aggregate([
                { $match: { adminId: req.session.adminId, 
                        isDeleted: false,
                        status: 'approved'
                    }
                },
                {
                    $lookup: {
                        from: 'invoices',
                        localField: 'invoiceId',
                        foreignField: '_id',
                        as: 'invoice'
                    }
                },
                { $unwind: { path: '$invoice', preserveNullAndEmptyArrays: true } },
                {
                    $group: {
                        _id: null,
                        totalRentCollected: {
                            $sum: {
                                $cond: [
                                    { $in: ['$invoice.type', ['monthly_rent', 'rent']] },
                                    '$amountPaid',
                                    0
                                ]
                            }
                        },
                        totalBookingDepositsCollected: {
                            $sum: {
                                $cond: [
                                    { $eq: ['$invoice.type', 'booking_deposit'] },
                                    '$amountPaid',
                                    0
                                ]
                            }
                        },
                        totalLateFeesCollected: {
                            $sum: {
                                $cond: [
                                    { $eq: ['$invoice.type', 'late_fee'] },
                                    '$amountPaid',
                                    0
                                ]
                            }
                        }
                    }
                }
            ]),

            // Total outstanding rent (sum of balances on open rent invoices)
            Invoice.aggregate([
                { $match: { adminId: req.session.adminId, 
                        isDeleted: false,
                        $and: [
                            { $or: [{ type: 'monthly_rent' }, { type: 'rent' }] },
                            { $or: [{ status: 'unpaid' }, { status: 'partial' }, { status: 'overdue' }] }
                        ]
                    }
                },
                {
                    $project: {
                        effBalance: {
                            $cond: [
                                { $gt: ['$balance', 0] },
                                '$balance',
                                {
                                    $let: {
                                        vars: {
                                            computed: {
                                                $subtract: [
                                                    '$totalAmount',
                                                    { $ifNull: ['$paidAmount', 0] }
                                                ]
                                            }
                                        },
                                        in: {
                                            $cond: [
                                                { $gt: ['$$computed', 0] },
                                                '$$computed',
                                                0
                                            ]
                                        }
                                    }
                                }
                            ]
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalOutstandingRent: { $sum: '$effBalance' }
                    }
                }
            ]),

            // Application status breakdown
            Application.aggregate([
                { $match: { adminId: req.session.adminId,  isDeleted: false } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ])
        ]);

        // Property overview mapping
        let totalProperties = 0;
        let availableProperties = 0;
        let reservedProperties = 0;
        let occupiedProperties = 0;

        propertyStatusAgg.forEach(row => {
            const status = row._id;
            const count = row.count || 0;
            totalProperties += count;
            if (status === 'available') availableProperties = count;
            if (status === 'reserved') reservedProperties = count;
            if (status === 'occupied') occupiedProperties = count;
        });

        const tenantStats = tenantAgg[0] || { totalTenants: 0, activeTenants: 0 };
        const tenantsWithOverdueRent = overdueTenantAgg[0]?.tenantsWithOverdueRent || 0;

        const financialStats = financialAgg[0] || {
            totalRentCollected: 0,
            totalBookingDepositsCollected: 0,
            totalLateFeesCollected: 0
        };

        const outstandingStats = outstandingAgg[0] || { totalOutstandingRent: 0 };

        // Application status mapping
        let pendingApplications = 0;
        let approvedApplications = 0;
        let expiredOrCancelledApplications = 0;

        applicationStatusAgg.forEach(row => {
            const status = row._id;
            const count = row.count || 0;
            if (status === 'pending') pendingApplications = count;
            if (status === 'approved') approvedApplications = count;
            if (status === 'expired' || status === 'cancelled') {
                expiredOrCancelledApplications += count;
            }
        });

        res.render('admin-reports', {
            layout: false,
            adminName: req.session.adminName,
            propertyOverview: {
                totalProperties,
                availableProperties,
                reservedProperties,
                occupiedProperties
            },
            tenantOverview: {
                totalTenants: tenantStats.totalTenants || 0,
                activeTenants: tenantStats.activeTenants || 0,
                tenantsWithOverdueRent
            },
            financialSummary: {
                totalRentCollected: financialStats.totalRentCollected || 0,
                totalOutstandingRent: outstandingStats.totalOutstandingRent || 0,
                totalBookingDepositsCollected: financialStats.totalBookingDepositsCollected || 0,
                totalLateFeesCollected: financialStats.totalLateFeesCollected || 0
            },
            applicationSummary: {
                pendingApplications,
                approvedApplications,
                expiredOrCancelledApplications
            }
        });
    } catch (err) {
        console.error('Admin reports error:', err);
        res.status(500).send('Error loading reports');
    }
};
