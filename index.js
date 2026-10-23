const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { useMongoDBAuthState } = require('./mongoAuthState');
const { MongoClient } = require('mongodb');
const express = require('express');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const mime = require('mime-types');
const multer = require('multer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const PHONE_NUMBER = process.env.PHONE_NUMBER || ''; // Phone number for pairing code (with country code, no + or -)
const MONGO_URL = process.env.MONGO_URL; // MongoDB connection URL
const API_KEY = process.env.API_KEY || '';           // Opcional: si se define, se exige el header x-api-key
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';   // Opcional: dominio(s) permitidos, separados por coma (ej. https://tu-sitio.com)

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 } // 20 MB (sube el límite si tu hosting tiene más RAM)
});

let sock;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let mongoClient; // MongoDB client instance

// ---------- Middlewares ----------

// CORS: solo se activa si defines CORS_ORIGIN
if (CORS_ORIGIN) {
    app.use(cors({ origin: CORS_ORIGIN.split(',').map(o => o.trim()) }));
}

// API key: solo se exige si defines API_KEY (el health check "/" queda libre)
app.use((req, res, next) => {
    if (!API_KEY || req.path === '/') return next();
    if (req.get('x-api-key') !== API_KEY) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    next();
});

// ---------- Helpers ----------

// Convierte un número o ID de grupo en un JID de WhatsApp
function resolveJid(number) {
    if (number.includes('@g.us')) {
        return { jid: number, recipientId: number, isGroup: true };
    }

    // Quita todo lo que no sea dígito o guion
    const cleaned = number.replace(/[^\d-]/g, '');

    // Grupo: dos bloques de dígitos separados por un guion (ej. 1234567890-1234567890)
    if (/^(\d{10,})-(\d{10,})$/.test(cleaned)) {
        return { jid: cleaned + '@g.us', recipientId: cleaned, isGroup: true };
    }

    // Número individual
    const digits = number.replace(/\D/g, '');
    if (digits.length < 10) return null;
    return { jid: digits + '@s.whatsapp.net', recipientId: digits, isGroup: false };
}

// Arma el contenido del mensaje según el tipo de archivo.
// source puede ser { url } o un Buffer
function buildMediaContent(source, fileName, caption) {
    const mimetype = mime.lookup(fileName) || 'application/octet-stream';
    if (mimetype.startsWith('image/')) return { image: source, caption };
    if (mimetype.startsWith('video/')) return { video: source, caption };
    if (mimetype.startsWith('audio/')) return { audio: source, mimetype };
    return { document: source, mimetype, fileName, caption };
}

// ---------- WhatsApp ----------

// Initialize WhatsApp connection
async function connectToWhatsApp() {
    // Connect to MongoDB if not already connected
    if (!mongoClient) {
        if (!MONGO_URL) {
            console.error('ERROR: MONGO_URL environment variable is not set!');
            console.error('Please set MONGO_URL to your MongoDB connection string.');
            process.exit(1);
        }

        try {
            mongoClient = new MongoClient(MONGO_URL);
            await mongoClient.connect();
            console.log('Connected to MongoDB successfully');
        } catch (error) {
            console.error('Failed to connect to MongoDB:', error.message);
            process.exit(1);
        }
    }

    // Get MongoDB collection for auth state
    const collection = mongoClient.db("whatsapp_bot").collection("auth");

    // Use MongoDB for authentication state
    const { state, saveCreds } = await useMongoDBAuthState(collection);

    // Fetch latest Baileys version for compatibility
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        getMessage: async (key) => {
            return { conversation: '' };
        }
    });

    // Request pairing code if phone number is provided and not registered
    if (PHONE_NUMBER) {
        // Delay to ensure WebSocket connection is fully established before requesting pairing code
        setTimeout(async () => {
            try {
                // Check registration state at execution time to avoid race conditions
                if (!state.creds.registered) {
                    const code = await sock.requestPairingCode(PHONE_NUMBER);
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                    console.log('🔐 PAIRING CODE (8-digit code):');
                    console.log('   ' + code);
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                    console.log('To connect:');
                    console.log('1. Open WhatsApp on your phone');
                    console.log('2. Go to Settings > Linked Devices');
                    console.log('3. Tap "Link a Device"');
                    console.log('4. Enter this code: ' + code);
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                }
            } catch (error) {
                console.error('Error requesting pairing code:', error.message);
            }
        }, 3000);
    }

    // Handle QR code
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📱 QR Code received, scan with WhatsApp:');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            qrcode.generate(qr, { small: true });
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

            // Inform user about pairing code option if phone number is configured
            if (PHONE_NUMBER) {
                console.log('OR use the 8-digit pairing code (displayed above or in console)');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log('Connection closed due to', lastDisconnect?.error, ', reconnecting:', shouldReconnect);

            if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                console.log(`Reconnecting attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms...`);
                setTimeout(() => connectToWhatsApp(), delay);
            } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                console.error('Max reconnection attempts reached. Please restart the bot.');
            } else {
                console.log('Logged out. Please restart the bot to scan QR code again.');
            }
        } else if (connection === 'open') {
            console.log('Connected to WhatsApp successfully!');
            reconnectAttempts = 0; // Reset counter on successful connection
        }
    });

    // Save credentials whenever they update
    sock.ev.on('creds.update', saveCreds);
}

// ---------- Rutas ----------

// Enviar mensaje de texto
app.get('/send', async (req, res) => {
    const { number, message } = req.query;

    if (!number || !message) {
        return res.status(400).json({
            error: 'Missing required parameters: number and message'
        });
    }

    if (!sock) {
        return res.status(500).json({
            error: 'WhatsApp connection not established'
        });
    }

    const target = resolveJid(number);
    if (!target) {
        return res.status(400).json({
            error: 'Invalid phone number. Must contain at least 10 digits.'
        });
    }

    try {
        await sock.sendMessage(target.jid, { text: message });

        res.json({
            success: true,
            message: 'Message sent successfully',
            to: target.recipientId,
            type: target.isGroup ? 'group' : 'individual'
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({
            error: 'Failed to send message',
            details: error.message
        });
    }
});

// Enviar adjunto desde una URL pública
// GET /send-media?number=...&url=...&caption=...&filename=...
app.get('/send-media', async (req, res) => {
    const { number, url, caption, filename } = req.query;

    if (!number || !url) {
        return res.status(400).json({
            error: 'Missing required parameters: number and url'
        });
    }

    if (!sock) {
        return res.status(500).json({
            error: 'WhatsApp connection not established'
        });
    }

    const target = resolveJid(number);
    if (!target) {
        return res.status(400).json({
            error: 'Invalid phone number. Must contain at least 10 digits.'
        });
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch (e) {
        return res.status(400).json({ error: 'Invalid url' });
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return res.status(400).json({ error: 'Only http/https urls are allowed' });
    }

    try {
        const fileName = filename || path.basename(parsedUrl.pathname) || 'archivo';
        await sock.sendMessage(target.jid, buildMediaContent({ url }, fileName, caption));

        res.json({
            success: true,
            message: 'Media sent successfully',
            to: target.recipientId,
            type: target.isGroup ? 'group' : 'individual',
            fileName
        });
    } catch (error) {
        console.error('Error sending media:', error);
        res.status(500).json({
            error: 'Failed to send media',
            details: error.message
        });
    }
});

// Enviar adjunto subido (multipart/form-data)
// Campos: number, caption (opcional), file (el archivo)
app.post('/send-file', upload.single('file'), async (req, res) => {
    const { number, caption } = req.body;

    if (!number || !req.file) {
        return res.status(400).json({
            error: 'Missing required fields: number and file'
        });
    }

    if (!sock) {
        return res.status(500).json({
            error: 'WhatsApp connection not established'
        });
    }

    const target = resolveJid(number);
    if (!target) {
        return res.status(400).json({
            error: 'Invalid phone number. Must contain at least 10 digits.'
        });
    }

    try {
        await sock.sendMessage(
            target.jid,
            buildMediaContent(req.file.buffer, req.file.originalname, caption)
        );

        res.json({
            success: true,
            message: 'File sent successfully',
            to: target.recipientId,
            type: target.isGroup ? 'group' : 'individual',
            fileName: req.file.originalname
        });
    } catch (error) {
        console.error('Error sending file:', error);
        res.status(500).json({
            error: 'Failed to send file',
            details: error.message
        });
    }
});

// Errores de multer (por ejemplo archivo demasiado grande)
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
    }
    next(err);
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        connected: !!sock
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    connectToWhatsApp();
});
