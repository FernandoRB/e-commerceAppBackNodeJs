const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const morgan = require('morgan');
const cors = require('cors');
const basicAuth = require('express-basic-auth');

if (process.env.NODE_ENV !== "production") {
  require('dotenv').config();
}

const app = express();

// ===== DB =====
mongoose.set('strictQuery', true);
mongoose.connect(process.env.MONGODB_URI, { dbName: 'ecommerce' })
  .then(() => console.log('[DB] Conectado'))
  .catch(err => {
    console.error('[DB] Error:', err); 
  });

// ===== CORS (antes que todo) =====
const allowedOrigins = [
  'https://app-book-reviews-front.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:4200'
  

];
 
 
 const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // requests internos o curl sin origin

    if (typeof origin === "string") {
      // Normalizamos quitando barra final
      const cleanOrigin = origin.replace(/\/$/, "");

      if (
        allowedOrigins.includes(cleanOrigin) ||
        cleanOrigin.endsWith(".vercel.app")
      ) {
        return cb(null, true);
      }
    }

    console.error("CORS bloqueado para:", origin);
    return cb(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // preflight global

// ===== JSON + Logs =====
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// ===== Basic Auth (NO aplica a OPTIONS) =====
if (process.env.BASIC_USER && process.env.BASIC_PASS) {
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    return basicAuth({
      users: { [process.env.BASIC_USER]: process.env.BASIC_PASS },
      challenge: true
    })(req, res, next);
  });
}

// ===== Modelos =====
const { Schema, model } = mongoose;

 
const ProductSchema = new Schema({
  name: { type: String, required: true },          // Nombre del producto
  price: { type: Number, required: true },         // Precio obligatorio
  stock: { type: Number, default: 0 },             // Stock por defecto es de 0
  imageBase64: { type: String, required: true },   // Imagen en Base64 (obligatoria)
  imageMimeType: { type: String, default: 'image/jpeg' }, // Tipo MIME de la imagen
  createdAt: { type: Date, default: Date.now }     // Fecha de creación
});

const Product = model('Product', ProductSchema);


const SearchSchema = new Schema({
  client: { type: String, index: true },
  query: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const SearchLog = model('SearchLog', SearchSchema);



// ====== ENDPOINTS PRODUCTOS ======

// GET - Listar todos los productos
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).lean();

    // Adjuntamos prefijo correcto para que Angular pueda renderizar la imagen
    const items = products.map(prod => ({
      ...prod,
      image: `data:${prod.imageMimeType || 'image/jpeg'};base64,${prod.imageBase64}`
    }));

    res.json({ items });
  } catch (err) {
    console.error('[PRODUCTS][GET]', err.message);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});


// POST - Crear nuevo producto
app.post('/api/products', async (req, res) => {
  try {
    const { name, price, stock, imageBase64, imageMimeType } = req.body;

    // Validar datos obligatorios
    if (!name || !price || !imageBase64) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    const newProduct = await Product.create({
      name,
      price,
      stock,
      imageBase64,
      imageMimeType: imageMimeType || 'image/jpeg' // Guardamos tipo de imagen dinámico
    });

    console.log('[PRODUCTS][CREATE]', newProduct._id.toString(), name);
    res.status(201).json(newProduct);
  } catch (err) {
    console.error('[PRODUCTS][CREATE]', err.message);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});


// DELETE - Eliminar producto por ID
app.delete('/api/products/:id', async (req, res) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Producto no encontrado' });

    console.log('[PRODUCTS][DELETE]', deleted._id.toString());
    res.json({ ok: true });
  } catch (err) {
    console.error('[PRODUCTS][DELETE]', err.message);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});



// ------------------------------------------------------------------------------------------------

// ===== Login =====
const UserSchema = new Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = model('User', UserSchema);

// app.post('/api/login', async (req, res) => {
//   try {
//     const { username, password } = req.body;
//     if (!username || !password) {
//       return res.status(400).json({ error: 'Faltan credenciales' });
//     }
//     const user = await User.findOne({ username }).lean();
//       console.log('👤 Usuario encontrado:', user);

//     if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
//     if (user.password !== password) {
//          console.log('❌ Contraseña incorrecta');
//       return res.status(401).json({ error: 'Contraseña incorrecta' });
//     }
//     console.log('✅ Login exitoso')
//     return res.json({ token: 'ok-' + user._id.toString() });
//   } catch (err) {
//     console.error('🔥 Error en login:', err);
//     return res.status(500).json({ error: 'Error en login' });
//   }
// });



app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Verificamos que haya credenciales
    if (!username || !password) {
      return res.status(400).json({ error: 'Faltan credenciales' });
    }

    // Buscamos el usuario
    const user = await User.findOne({ username }).lean();

    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    // Comparamos password directo, SIN bcrypt
    if (user.password !== password) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // Si todo OK, devolvemos token
    return res.status(200).json({
      message: 'Login exitoso',
      token: 'ok-' + user._id.toString()
    });

  } catch (err) {
    console.error('🔥 ERROR en login:', err.message);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
});



// ===== Healthcheck =====
app.get('/', (_req, res) => res.status(200).send('OK'));

 const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`[API] Running on port ${port}`);
});
