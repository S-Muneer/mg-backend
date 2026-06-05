const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const { OrderStatus } = require("@prisma/client");
const prisma = require("./prisma");
const cloudinary = require("./cloudinary");
const multer = require("multer");

dotenv.config();

const { signToken, authenticate, requireRole } = require("./middleware/auth");
const { bootstrapData } = require("./utils/seedData");
const { port, corsOrigins, defaultProductImage, jwtSecret } = require("./config");

const app = express();
const adminEventClients = new Set();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes("*") || corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProduct(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    image: product.image,
    description: product.description || "",
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    inStock: Boolean(product.inStock),
    rating: product.rating,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function parseProductPayload(body, partial = false) {
  const payload = {};

  if (!partial || body.name !== undefined) {
    if (!body.name || typeof body.name !== "string") {
      throw new Error("Product name is required");
    }
    payload.name = body.name.trim();
  }

  if (!partial || body.category !== undefined) {
    payload.category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : "General";
  }

  if (!partial || body.price !== undefined) {
    const price = toNumber(body.price);
    if (price === null || price < 0) {
      throw new Error("Valid product price is required");
    }
    payload.price = price;
  }

  if (!partial || body.image !== undefined) {
    payload.image =
      typeof body.image === "string" && body.image.trim()
        ? body.image.trim()
        : defaultProductImage;
  }

  if (!partial || body.description !== undefined) {
    payload.description = typeof body.description === "string" ? body.description.trim() : "";
  }

  if (!partial || body.sizes !== undefined) {
    const sizes = Array.isArray(body.sizes)
      ? body.sizes
          .map((size) => String(size).trim())
          .filter(Boolean)
      : [];
    payload.sizes = sizes;
  }

  if (!partial || body.inStock !== undefined) {
    payload.inStock = Boolean(body.inStock);
  }

  if (!partial || body.rating !== undefined) {
    const rating = toNumber(body.rating);
    payload.rating = rating === null ? 4.2 : Math.max(0, Math.min(5, rating));
  }

  return payload;
}

function parseShippingAddress(value) {
  if (!value || typeof value !== "object") return null;
  const fullName = String(value.fullName || "").trim();
  const address = String(value.address || "").trim();
  const city = String(value.city || "").trim();
  const pincode = String(value.pincode || "").trim();

  if (!fullName || !address || !city || !pincode) return null;
  return { fullName, address, city, pincode };
}

function formatOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    paymentMethod: order.paymentMethod,
    status: order.status,
    total: order.total,
    shippingAddress: order.shippingAddress,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    user: order.user
      ? {
          id: order.user.id,
          name: order.user.name,
          email: order.user.email,
        }
      : null,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      priceAtPurchase: item.priceAtPurchase,
      quantity: item.quantity,
      size: item.size,
    })),
  };
}

function sendAdminEvent(type, payload) {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of adminEventClients) {
    client.write(message);
  }
}

async function buildOrderNumber() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const orderNumber = `ORD-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const existing = await prisma.order.findUnique({ where: { orderNumber } });
    if (!existing) return orderNumber;
  }
  return `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

app.get("/api/health", async (_req, res) => {
  const productCount = await prisma.product.count();
  res.json({
    ok: true,
    productCount,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/admin/events", (req, res) => {
  const token = String(req.query?.access_token || "").trim();

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const auth = jwt.verify(token, jwtSecret);
    if (auth.role !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  adminEventClients.add(res);
  res.write('event: connected\ndata: {"ok":true}\n\n');

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    adminEventClients.delete(res);
  });

  return undefined;
});

app.post("/api/auth/admin/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin) return res.status(401).json({ message: "Invalid credentials" });

  const validPassword = await bcrypt.compare(password, admin.password);
  if (!validPassword) return res.status(401).json({ message: "Invalid credentials" });

  const token = signToken({ sub: admin.id, role: "admin", email: admin.email });
  return res.json({
    token,
    user: {
      id: admin.id,
      email: admin.email,
      role: "admin",
    },
  });
});

app.post("/api/auth/user/register", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!name || !email || password.length < 6) {
    return res
      .status(400)
      .json({ message: "Name, valid email, and password (min 6 chars) are required" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ message: "User already exists with this email" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: passwordHash,
    },
  });

  const token = signToken({
    sub: user.id,
    role: "user",
    email: user.email,
    name: user.name,
  });

  return res.status(201).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: "user",
    },
  });
});

app.post("/api/auth/user/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) return res.status(401).json({ message: "Invalid credentials" });

  const token = signToken({
    sub: user.id,
    role: "user",
    email: user.email,
    name: user.name,
  });

  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: "user",
    },
  });
});

app.get("/api/auth/me", authenticate(), async (req, res) => {
  if (req.auth.role === "admin") {
    const admin = await prisma.admin.findUnique({
      where: { id: Number(req.auth.sub) },
    });
    if (!admin) return res.status(401).json({ message: "Session not found" });
    return res.json({
      user: { id: admin.id, email: admin.email, role: "admin" },
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: Number(req.auth.sub) },
  });
  if (!user) return res.status(401).json({ message: "Session not found" });
  return res.json({
    user: { id: user.id, name: user.name, email: user.email, role: "user" },
  });
});

app.get("/api/products", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const category = String(req.query.category || "").trim();
  const sort = String(req.query.sort || "latest");

  const orderBy =
    sort === "price-low"
      ? { price: "asc" }
      : sort === "price-high"
      ? { price: "desc" }
      : sort === "rating"
      ? { rating: "desc" }
      : { createdAt: "desc" };

  const where = {
    ...(search
      ? {
          name: {
            contains: search,
            mode: "insensitive",
          },
        }
      : {}),
    ...(category && category !== "All" ? { category } : {}),
  };

  const products = await prisma.product.findMany({
    where,
    orderBy,
  });
  return res.json(products.map(normalizeProduct));
});

app.get("/api/products/:id", async (req, res) => {
  const id = toNumber(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid product id" });

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).json({ message: "Product not found" });
  return res.json(normalizeProduct(product));
});


app.post(
  "/api/products",
  authenticate(),
  requireRole("admin"),
  async (req, res) => {
    const payload = parseProductPayload(req.body, false);
    const product = await prisma.product.create({ data: payload });
    return res.status(201).json(normalizeProduct(product));
  }
);

app.put(
  "/api/products/:id",
  authenticate(),
  requireRole("admin"),
  async (req, res) => {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid product id" });

    const payload = parseProductPayload(req.body, true);
    const product = await prisma.product.update({
      where: { id },
      data: payload,
    });
    return res.json(normalizeProduct(product));
  }
);

app.delete(
  "/api/products/:id",
  authenticate(),
  requireRole("admin"),
  async (req, res) => {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid product id" });

    await prisma.product.delete({ where: { id } });
    return res.status(204).send();
  }
);

app.post("/api/orders", authenticate(false), async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  const shippingAddress = parseShippingAddress(body.shippingAddress);
  const paymentMethod = String(body.paymentMethod || "COD").trim() || "COD";

  if (!shippingAddress) {
    return res.status(400).json({ message: "Complete shipping address is required" });
  }

  if (items.length === 0) {
    return res.status(400).json({ message: "Order items are required" });
  }

  const normalizedItems = items
    .map((item) => {
      const productId = toNumber(item.productId);
      const quantity = toNumber(item.quantity);
      const size = item.size ? String(item.size).trim() : null;
      return {
        productId,
        quantity,
        size,
      };
    })
    .filter((item) => item.productId && item.quantity && item.quantity > 0);

  if (normalizedItems.length === 0) {
    return res.status(400).json({ message: "Valid order items are required" });
  }

  const productIds = [...new Set(normalizedItems.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  for (const item of normalizedItems) {
    const product = productById.get(item.productId);
    if (!product) {
      return res.status(404).json({ message: `Product ${item.productId} not found` });
    }
    if (!product.inStock) {
      return res
        .status(400)
        .json({ message: `${product.name} is currently out of stock` });
    }
  }

  const authUser =
    req.auth?.role === "user"
      ? await prisma.user.findUnique({
          where: { id: Number(req.auth.sub) },
        })
      : null;

  const customerName = String(body.customerName || authUser?.name || shippingAddress.fullName || "").trim();
  const customerEmail = String(body.customerEmail || authUser?.email || "").trim().toLowerCase();

  if (!customerName || !customerEmail) {
    return res.status(400).json({ message: "Customer name and email are required" });
  }

  const lineItems = normalizedItems.map((item) => {
    const product = productById.get(item.productId);
    return {
      productId: product.id,
      productName: product.name,
      priceAtPurchase: product.price,
      quantity: item.quantity,
      size: item.size,
    };
  });

  const total = lineItems.reduce(
    (sum, item) => sum + item.priceAtPurchase * item.quantity,
    0
  );

  const orderNumber = await buildOrderNumber();
  const order = await prisma.order.create({
    data: {
      orderNumber,
      userId: authUser?.id || null,
      customerName,
      customerEmail,
      shippingAddress,
      paymentMethod,
      total,
      items: {
        create: lineItems,
      },
    },
    include: {
      items: true,
      user: true,
    },
  });

  sendAdminEvent("order_created", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    total: order.total,
    updatedAt: order.updatedAt,
  });

  return res.status(201).json(formatOrder(order));
});

app.get(
  "/api/orders/my",
  authenticate(),
  requireRole("user"),
  async (req, res) => {
    const orders = await prisma.order.findMany({
      where: { userId: Number(req.auth.sub) },
      include: {
        items: true,
        user: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json(orders.map(formatOrder));
  }
);

app.get(
  "/api/orders",
  authenticate(),
  requireRole("admin"),
  async (_req, res) => {
    const orders = await prisma.order.findMany({
      include: {
        items: true,
        user: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json(orders.map(formatOrder));
  }
);

app.patch(
  "/api/orders/:id/status",
  authenticate(),
  requireRole("admin"),
  async (req, res) => {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid order id" });

    const status = String(req.body?.status || "").toUpperCase();
    const statuses = Object.values(OrderStatus);
    if (!statuses.includes(status)) {
      return res
        .status(400)
        .json({ message: `Invalid status. Allowed: ${statuses.join(", ")}` });
    }

    const order = await prisma.order.update({
      where: { id },
      data: { status },
      include: {
        items: true,
        user: true,
      },
    });

    sendAdminEvent("order_status_updated", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      total: order.total,
      updatedAt: order.updatedAt,
    });

    return res.json(formatOrder(order));
  }
);

app.get(
  "/api/admin/stats",
  authenticate(),
  requireRole("admin"),
  async (_req, res) => {
    const toLocalDateKey = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    // Support query params for filtering: period=week|month|year or custom startDate/endDate (YYYY-MM-DD)
    const { period, startDate: startQ, endDate: endQ } = _req.query || {};

    const today = new Date();
    const endDate = endQ ? new Date(String(endQ)) : new Date(today);
    endDate.setHours(23, 59, 59, 999);

    let startDate;
    if (startQ) {
      startDate = new Date(String(startQ));
    } else if (period === "month") {
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 29);
    } else if (period === "year") {
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 364);
    } else {
      // default to week
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);
    }
    startDate.setHours(0, 0, 0, 0);

    const dateRangeWhere = {
      updatedAt: { gte: startDate, lte: endDate },
    };

    const [
      productCount,
      orderCount,
      pendingCount,
      deliveredCount,
      revenueAggregate,
      ordersInRange,
      groupedStatuses,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.order.count({ where: dateRangeWhere }),
      prisma.order.count({
        where: { ...dateRangeWhere, status: { in: [OrderStatus.PENDING, OrderStatus.CONFIRMED] } },
      }),
      prisma.order.count({ where: { ...dateRangeWhere, status: OrderStatus.DELIVERED } }),
      prisma.order.aggregate({
        where: { ...dateRangeWhere, status: { not: OrderStatus.CANCELLED } },
        _sum: { total: true },
      }),
      prisma.order.findMany({
        where: { ...dateRangeWhere, status: OrderStatus.DELIVERED },
        select: { updatedAt: true, total: true },
      }),
      prisma.order.groupBy({
        by: ["status"],
        where: dateRangeWhere,
        _count: { _all: true },
      }),
    ]);

    const fmt = new Intl.DateTimeFormat("en-US", { weekday: "short" });
    const dailyTotals = new Map();
    const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    for (let i = 0; i < days; i += 1) {
      const day = new Date(startDate);
      day.setDate(startDate.getDate() + i);
      const key = toLocalDateKey(day);
      dailyTotals.set(key, { day: fmt.format(day), sales: 0 });
    }

    for (const order of ordersInRange) {
      const key = toLocalDateKey(order.updatedAt);
      const entry = dailyTotals.get(key);
      if (entry) entry.sales += order.total;
    }

    const statusCountMap = new Map(
      groupedStatuses.map((row) => [row.status, row._count._all])
    );

    const shipped = statusCountMap.get(OrderStatus.SHIPPED) || 0;
    const delivered = statusCountMap.get(OrderStatus.DELIVERED) || 0;
    const cancelled = statusCountMap.get(OrderStatus.CANCELLED) || 0;
    const pending =
      (statusCountMap.get(OrderStatus.PENDING) || 0) +
      (statusCountMap.get(OrderStatus.CONFIRMED) || 0);

    return res.json({
      totals: {
        products: productCount,
        orders: orderCount,
        pending: pendingCount,
        delivered: deliveredCount,
        revenue: revenueAggregate._sum.total || 0,
      },
      salesByDay: [...dailyTotals.values()],
      orderStatus: [
        { name: "Delivered", value: delivered, color: "#06b6d4" },
        { name: "Shipped", value: shipped, color: "#6366f1" },
        { name: "Pending", value: pending, color: "#f59e0b" },
        { name: "Cancelled", value: cancelled, color: "#ef4444" },
      ],
    });
  }
);

const upload = multer({ dest: "uploads/" });

app.post(
  "/api/uploads/product-image",
  authenticate(),
  requireRole("admin"),
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }

      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: process.env.CLOUDINARY_FOLDER || "mg-fashions",
        public_id: `product-${Date.now()}`,
        transformation: [
          { width: 800, height: 800, crop: "limit" },
          { quality: "auto" },
        ],
      });

      return res.json({
        url: result.secure_url,
        publicId: result.public_id,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Upload error:", error);
      return res.status(500).json({ message: "Failed to upload image" });
    }
  }
);

app.use((err, _req, res, _next) => {
  const isNotFound = err.code === "P2025";
  const statusCode = isNotFound ? 404 : 500;
  const message = isNotFound
    ? "Requested resource was not found"
    : err.message || "Internal server error";
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(statusCode).json({ message });
});

async function startServer() {
  await prisma.$connect();
  await bootstrapData(prisma);

  app.listen(port, () => {
    // Backend started successfully
  });
}

module.exports = {
  app,
  startServer,
};
