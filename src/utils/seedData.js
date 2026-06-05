const bcrypt = require("bcryptjs");
const { adminEmail, adminPassword, defaultProductImage } = require("../config");

const starterProducts = [
  {
    name: "Floral Kurti Set",
    category: "Ladies Wear",
    price: 1899,
    image: "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/floral-kurti.jpg",
    description:
      "Breathable cotton kurti set with floral print, matching dupatta, and all-day comfort fit.",
    sizes: ["S", "M", "L", "XL"],
    inStock: true,
    rating: 4.7,
  },
  {
    name: "Cotton Chudidar",
    category: "Ladies Wear",
    price: 1499,
    image: "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/cotton-chudidar.jpg",
    description:
      "Soft-touch cotton chudidar set designed for daily wear with premium stitching details.",
    sizes: ["S", "M", "L", "XL"],
    inStock: true,
    rating: 4.5,
  },
  {
    name: "Top & Bottom Set",
    category: "Ladies Wear",
    price: 1699,
    image: "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/top-bottom-set.jpg",
    description:
      "Elegant coordinated top and bottom set for casual brunches, office wear, and outings.",
    sizes: ["M", "L", "XL"],
    inStock: true,
    rating: 4.6,
  },
  {
    name: "Designer Suit Set",
    category: "Ladies Wear",
    price: 2499,
    image: "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/designer-suit.jpg",
    description:
      "Festive-ready designer suit set with detailed embroidery and luxurious drape.",
    sizes: ["S", "M", "L"],
    inStock: true,
    rating: 4.8,
  },
  {
    name: "Kids Party Dress",
    category: "Kids Wear",
    price: 1299,
    image: "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/kids-party-dress.jpg",
    description:
      "Comfort-first party dress for kids with lightweight fabric and vibrant finishing.",
    sizes: ["2-3Y", "4-5Y", "6-7Y"],
    inStock: true,
    rating: 4.4,
  },
  {
    name: "Boys Casual Set",
    category: "Kids Wear",
    price: 999,
    image: "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/boys-casual-set.jpg",
    description:
      "Two-piece casual set for active kids, made with soft stretchable cotton blend.",
    sizes: ["2-3Y", "4-5Y", "6-7Y"],
    inStock: false,
    rating: 4.2,
  },
  {
    name: "Cotton T-Shirt",
    category: "Men",
    price: 499,
    image: "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/cotton-tshirt.jpg",
    description:
      "Classic crew neck cotton t-shirt with clean fit and durable everyday quality.",
    sizes: ["S", "M", "L", "XL"],
    inStock: true,
    rating: 4.3,
  },
  {
    name: "Denim Jacket",
    category: "Women",
    price: 1999,
    image: "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/denim-jacket.jpg",
    description:
      "Structured denim jacket with modern silhouette, perfect for layering across seasons.",
    sizes: ["S", "M", "L"],
    inStock: true,
    rating: 4.6,
  },
  {
    name: "Casual Shirt",
    category: "Men",
    price: 899,
    image: "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/casual-shirt.jpg",
    description:
      "Lightweight casual shirt with sharp collar and breathable weave for daily style.",
    sizes: ["M", "L", "XL"],
    inStock: true,
    rating: 4.4,
  },
  {
    name: "Kurti Set",
    category: "Women",
    price: 1299,
    image: "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/kurti-set.jpg",
    description:
      "Contemporary kurti set balancing ethnic detailing and modern comfort.",
    sizes: ["S", "M", "L", "XL"],
    inStock: true,
    rating: 4.5,
  },
  {
    name: "Hoodie",
    category: "Unisex",
    price: 1499,
    image: "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/hoodie.jpg",
    description:
      "Warm fleece hoodie with relaxed fit and clean minimal style.",
    sizes: ["S", "M", "L", "XL"],
    inStock: true,
    rating: 4.5,
  },
  {
    name: "Jeans",
    category: "Men",
    price: 1199,
    image: "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/jeans.jpg",
    description:
      "Stretch denim jeans with tapered fit and all-day comfort for regular wear.",
    sizes: ["30", "32", "34", "36"],
    inStock: true,
    rating: 4.3,
  },
];

const productImageByName = new Map(
  starterProducts.map((product) => [product.name, product.image])
);

async function seedDefaultAdmin(prisma) {
  const existingAdmin = await prisma.admin.findUnique({
    where: { email: adminEmail },
  });
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  if (!existingAdmin) {
    await prisma.admin.create({
      data: {
        email: adminEmail,
        password: passwordHash,
      },
    });
    return;
  }

  const matchesConfiguredPassword = await bcrypt.compare(
    adminPassword,
    existingAdmin.password
  );

  if (!matchesConfiguredPassword) {
    await prisma.admin.update({
      where: { id: existingAdmin.id },
      data: { password: passwordHash },
    });
  }
}

async function seedProducts(prisma) {
  const productCount = await prisma.product.count();
  if (productCount > 0) return;

  await prisma.product.createMany({
    data: starterProducts,
  });
}

async function syncStarterProductImages(prisma) {
  const products = await prisma.product.findMany({
    where: {
      name: {
        in: [...productImageByName.keys()],
      },
    },
    select: {
      id: true,
      name: true,
      image: true,
    },
  });

  const updates = products
    .map((product) => {
      const localImage = productImageByName.get(product.name);
      const currentImage = String(product.image || "").trim();
      const shouldMigrate =
        !currentImage ||
        currentImage.startsWith("/media/") ||
        /picsum\.photos|images\.unsplash\.com/i.test(currentImage);

      if (!localImage || !shouldMigrate || currentImage === localImage) {
        return null;
      }
      return prisma.product.update({
        where: { id: product.id },
        data: { image: localImage },
      });
    })
    .filter(Boolean);

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }
}

async function bootstrapData(prisma) {
  await seedDefaultAdmin(prisma);
  await seedProducts(prisma);
  await syncStarterProductImages(prisma);
}

module.exports = {
  bootstrapData,
};
