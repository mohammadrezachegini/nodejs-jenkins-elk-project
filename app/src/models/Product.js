/**
 * Product.js — Mongoose model
 *
 * A simple product catalog with name, price, category, stock, and soft-delete.
 * Soft-delete (isActive: false) lets us "remove" products without losing history.
 */

'use strict';

const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
      default: '',
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
      enum: {
        values: ['electronics', 'clothing', 'food', 'books', 'sports', 'other'],
        message: 'Category must be one of: electronics, clothing, food, books, sports, other',
      },
    },
    stock: {
      type: Number,
      default: 0,
      min: [0, 'Stock cannot be negative'],
    },
    sku: {
      type: String,
      unique: true,
      sparse: true,   // allow multiple docs with no SKU
      trim: true,
      uppercase: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,    // adds createdAt / updatedAt
    versionKey: false,   // don't add __v
  }
);

// Index for fast category + active queries (most common filter pattern)
productSchema.index({ category: 1, isActive: 1 });
// Text index for basic search
productSchema.index({ name: 'text', description: 'text' });

// Virtual: don't expose internal fields in JSON responses
productSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Product', productSchema);
