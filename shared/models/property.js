const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    propertyname: { type: String, required: true },
    propertyaddress: { type: String, required: true },
    city: { type: String },
    state: { type: String },
    pincode: { type: String },
    propertytype: { type: String, enum: ['apartment', 'house', 'villa', 'commercial'] },
    rent: { type: Number, required: true },
    deposit: { type: Number },
    // New: booking deposit required to reserve property
    bookingDeposit: { type: Number, required: true },
    bedrooms: { type: Number },
    bathrooms: { type: Number },
    area: { type: Number },
    description: { type: String },
    amenities: [String],
    images: [String],
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    // Status now supports full reservation and lease lifecycle
    status: { type: String, default: 'available', enum: ['available', 'reserved', 'leased', 'occupied', 'maintenance'] },
    isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Property', propertySchema, 'properties');
