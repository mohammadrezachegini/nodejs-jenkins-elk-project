/**
 * routes/products.js — Product CRUD endpoints
 *
 * Routes:
 *   GET    /api/products          list all (with filtering, pagination)
 *   GET    /api/products/:id      get one by ID
 *   POST   /api/products          create new product
 *   PUT    /api/products/:id      update product
 *   DELETE /api/products/:id      soft-delete product
 *   GET    /api/products/search   text search
 */

'use strict';

const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const Product = require('../models/Product');
const logger = require('../logger');

const router = express.Router();
const tracer = trace.getTracer('products-service');

// ── Helper: extract validation errors and return 422 ──────────────────────
function validateRequest(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }
  return null;
}

// ── GET /api/products ───────────────────────────────────────────────────────
// Supports: ?category=electronics&page=1&limit=10&sortBy=price&order=asc
router.get('/', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('category').optional().isString(),
  query('sortBy').optional().isIn(['name', 'price', 'createdAt', 'stock']),
  query('order').optional().isIn(['asc', 'desc']),
], async (req, res, next) => {
  // Create a custom span with extra attributes — OTel auto-instrumentation
  // already creates an HTTP span, but this adds business-level context
  const span = tracer.startSpan('products.list');

  try {
    if (validateRequest(req, res)) return;

    const {
      page = 1,
      limit = 10,
      category,
      sortBy = 'createdAt',
      order = 'desc',
    } = req.query;

    const filter = { isActive: true };
    if (category) filter.category = category;

    const skip = (page - 1) * limit;
    const sortObj = { [sortBy]: order === 'desc' ? -1 : 1 };

    span.setAttributes({
      'products.filter.category': category || 'all',
      'products.page': page,
      'products.limit': limit,
    });

    const [products, total] = await Promise.all([
      Product.find(filter).sort(sortObj).skip(skip).limit(limit),
      Product.countDocuments(filter),
    ]);

    logger.info('Products listed', {
      count: products.length,
      total,
      page,
      category: category || 'all',
    });

    span.setStatus({ code: SpanStatusCode.OK });

    res.json({
      data: products,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.recordException(err);
    next(err);
  } finally {
    span.end();
  }
});

// ── GET /api/products/search ───────────────────────────────────────────────
router.get('/search', [
  query('q').notEmpty().withMessage('Search query is required'),
], async (req, res, next) => {
  try {
    if (validateRequest(req, res)) return;

    const { q, limit = 10 } = req.query;

    const products = await Product.find(
      { $text: { $search: q }, isActive: true },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(parseInt(limit));

    logger.info('Product search', { query: q, results: products.length });
    res.json({ data: products });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/products/:id ──────────────────────────────────────────────────
router.get('/:id', [
  param('id').isMongoId().withMessage('Invalid product ID'),
], async (req, res, next) => {
  try {
    if (validateRequest(req, res)) return;

    const product = await Product.findOne({ _id: req.params.id, isActive: true });
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ data: product });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/products ─────────────────────────────────────────────────────
router.post('/', [
  body('name').notEmpty().isLength({ min: 2, max: 100 }),
  body('price').isFloat({ min: 0 }),
  body('category').isIn(['electronics', 'clothing', 'food', 'books', 'sports', 'other']),
  body('description').optional().isLength({ max: 500 }),
  body('stock').optional().isInt({ min: 0 }),
  body('sku').optional().isString().trim(),
], async (req, res, next) => {
  try {
    if (validateRequest(req, res)) return;

    const product = await Product.create(req.body);

    logger.info('Product created', {
      productId: product._id.toString(),
      name: product.name,
      category: product.category,
    });

    res.status(201).json({ data: product });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'SKU already exists' });
    }
    next(err);
  }
});

// ── PUT /api/products/:id ──────────────────────────────────────────────────
router.put('/:id', [
  param('id').isMongoId(),
  body('name').optional().isLength({ min: 2, max: 100 }),
  body('price').optional().isFloat({ min: 0 }),
  body('category').optional().isIn(['electronics', 'clothing', 'food', 'books', 'sports', 'other']),
  body('stock').optional().isInt({ min: 0 }),
], async (req, res, next) => {
  try {
    if (validateRequest(req, res)) return;

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      { $set: req.body },
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    logger.info('Product updated', { productId: product._id.toString() });
    res.json({ data: product });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/products/:id ───────────────────────────────────────────────
// Soft-delete: sets isActive = false, data is preserved
router.delete('/:id', [
  param('id').isMongoId(),
], async (req, res, next) => {
  try {
    if (validateRequest(req, res)) return;

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      { $set: { isActive: false } },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    logger.info('Product soft-deleted', { productId: product._id.toString() });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
