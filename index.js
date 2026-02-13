const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_DIR = 'auth_info';

// Middlewares para permitir peticiones desde tu HTML
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sock;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    console.log(`Versión de WhatsApp: ${version.join('.')}`);

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        // Identificación del cliente
        browser: ['Windows', 'Chrome', '11.0.0'], 
        generateHighQualityLinkPreview: true,
    });

    // Monitoreo de la conexión
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📱 Escanea el código QR para vincular:');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log('Conexión cerrada. Motivo:', lastDisconnect?.error?.message);
            
            if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                console.log(`Reintentando conexión (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                setTimeout(() => connectToWhatsApp(), 5000);
            } else {
                console.log('No se pudo reconectar. Verifica tu conexión o reinicia el bot.');
            }
        } else if (connection === 'open') {
            console.log('✅ Conexión establecida con éxito.');
            reconnectAttempts = 0;
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// ENDPOINT PARA EL HTML
app.get('/send', async (req, res) => {
    const { number, message } = req.query;
    
    if (!number || !message) {
        return res.status(400).json({ error: 'Faltan parámetros: número y mensaje.' });
    }
    
    if (!sock) {
        return res.status(503).json({ error: 'El servidor de WhatsApp no está listo.' });
    }
    
    try {
        // Limpiar el número y formatearlo
        const cleanNumber = number.replace(/[^\d]/g, '');
        const jid = `${cleanNumber}@s.whatsapp.net`;
        
        await sock.sendMessage(jid, { text: message });
        
        res.json({ 
            success: true, 
            to: cleanNumber,
            info: 'Mensaje enviado correctamente' 
        });
    } catch (error) {
        console.error('Error al enviar mensaje:', error);
        res.status(500).json({ error: 'Error interno al enviar el mensaje.' });
    }
});

// Inicio del servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
    connectToWhatsApp();
});
