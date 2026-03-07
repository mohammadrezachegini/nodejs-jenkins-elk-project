/**
 * products.test.js — Integration tests for the Products API
 *
 * Uses mongodb-memory-server so no real MongoDB is needed.
 * Supertest sends real HTTP requests against the Express app.
 */

'use strict';

// Mock tracing before anything else to avoid real OTel setup in tests
jest.mock('../src/tracing', () => ({}));

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { app } = require('../src/index');
const Product = require('../src/models/Product');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Product.deleteMany({});
});

describe('Product API', () => {
  const sampleProduct = {
    name: 'Test Laptop',
    description: 'A test laptop',
    price: 999.99,
    category: 'electronics',
    stock: 10,
    sku: 'LAPTOP-001',
  };

  // ── CREATE ───────────────────────────────────────────────────────────────
  describe('POST /api/products', () => {
    it('should create a product and return 201', async () => {
      const res = await request(app)
        .post('/api/products')
        .send(sampleProduct);

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Test Laptop');
      expect(res.body.data.price).toBe(999.99);
      expect(res.body.data._id).toBeDefined();
    });

    it('should return 422 for missing required fields', async () => {
      const res = await request(app)
        .post('/api/products')
        .send({ name: 'No price or category' });

      expect(res.status).toBe(422);
      expect(res.body.errors).toBeDefined();
    });

    it('should return 422 for invalid category', async () => {
      const res = await request(app)
        .post('/api/products')
        .send({ ...sampleProduct, category: 'invalid' });

      expect(res.status).toBe(422);
    });

    it('should return 409 for duplicate SKU', async () => {
      await request(app).post('/api/products').send(sampleProduct);
      const res = await request(app).post('/api/products').send(sampleProduct);
      expect(res.status).toBe(409);
    });
  });

  // ── LIST ─────────────────────────────────────────────────────────────────
  describe('GET /api/products', () => {
    it('should return paginated products', async () => {
      await Product.create([
        { ...sampleProduct, sku: 'A1' },
        { ...sampleProduct, name: 'Phone', sku: 'A2', category: 'electronics' },
      ]);

      const res = await request(app).get('/api/products?page=1&limit=10');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination.total).toBe(2);
    });

    it('should filter by category', async () => {
      await Product.create([
        { ...sampleProduct, sku: 'B1' },
        { ...sampleProduct, name: 'T-Shirt', sku: 'B2', category: 'clothing', price: 29 },
      ]);

      const res = await request(app).get('/api/products?category=clothing');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('T-Shirt');
    });
  });

  // ── GET BY ID ─────────────────────────────────────────────────────────────
  describe('GET /api/products/:id', () => {
    it('should return a product by ID', async () => {
      const product = await Product.create(sampleProduct);
      const res = await request(app).get(`/api/products/${product._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data._id).toBe(product._id.toString());
    });

    it('should return 404 for non-existent product', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).get(`/api/products/${fakeId}`);
      expect(res.status).toBe(404);
    });
  });

  // ── UPDATE ────────────────────────────────────────────────────────────────
  describe('PUT /api/products/:id', () => {
    it('should update a product', async () => {
      const product = await Product.create(sampleProduct);
      const res = await request(app)
        .put(`/api/products/${product._id}`)
        .send({ price: 799.99 });

      expect(res.status).toBe(200);
      expect(res.body.data.price).toBe(799.99);
    });
  });

  // ── DELETE ────────────────────────────────────────────────────────────────
  describe('DELETE /api/products/:id', () => {
    it('should soft-delete a product', async () => {
      const product = await Product.create(sampleProduct);
      const res = await request(app).delete(`/api/products/${product._id}`);
      expect(res.status).toBe(204);

      // Should not appear in list after soft-delete
      const getRes = await request(app).get(`/api/products/${product._id}`);
      expect(getRes.status).toBe(404);

      // But should exist in DB with isActive: false
      const dbProduct = await Product.findById(product._id);
      expect(dbProduct.isActive).toBe(false);
    });
  });

  // ── HEALTH CHECK ──────────────────────────────────────────────────────────
  describe('GET /health', () => {
    it('should return status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
