const mongoose = require('mongoose');

const aiInsightSchema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', index: true },
    type: { type: String, required: true },
    relatedEntityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    result: { type: mongoose.Schema.Types.Mixed, required: true },
    confidenceScore: { type: Number, min: 0, max: 1 },
}, { timestamps: { createdAt: true, updatedAt: false } });

// Indexes to support lookups by entity and recency
aiInsightSchema.index({ type: 1, relatedEntityId: 1 });
aiInsightSchema.index({ adminId: 1, createdAt: -1 });

module.exports = mongoose.model('AIInsight', aiInsightSchema, 'aiinsights');
