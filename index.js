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
const cors = require('cors'); // Necesario para conectar con tu HTML

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_DIR = 'auth_info';

// Middlewares
app.use(cors());
app.use(express.json());

let sock;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    console.log(`Usando WA v${version.join('.')}, isLatest: ${isLatest}`);

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        // Configuración para evitar el error 405 en Termux/Linux
        browser: ['Ubuntu', 'Chrome', '20.0.04'], 
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
            return { conversation: '' };
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('--- NUEVO CÓDIGO QR ---');
            console.log('Escanea con tu WhatsApp:');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            
            // Si el error es 405, usualmente es por sesión corrupta o IP bloqueada temporalmente
            if (statusCode === 405) {
                console.error('❌ Error 405 detectado. Intenta borrar la carpeta "auth_info" y reiniciar.');
            }

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                console.log(`Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) en ${delay}ms...`);
                setTimeout(() => connectToWhatsApp(), delay);
            } else {
                console.log('Conexión terminada. Si no estás logueado, borra auth_info y escanea de nuevo.');
            }
        } else if (connection === 'open') {
            console.log('✅ ¡WhatsApp Conectado con éxito!');
            reconnectAttempts = 0;
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Ruta para enviar mensajes (Compatible con el fetch de tu HTML)
app.get('/send', async (req, res) => {
    const { number, message } = req.query;
    
    if (!number || !message) {
        return res.status(400).json({ error: 'Faltan parámetros: number y message' });
    }
    
    if (!sock || reconnectAttempts > 0) {
        return res.status(503).json({ error: 'WhatsApp no está listo o se está reconectando' });
    }
    
    try {
        const formattedNumber = number.replace(/[^\d]/g, '');
        const jid = formattedNumber + '@s.whatsapp.net';
        
        await sock.sendMessage(jid, { text: message });
        
        res.json({ 
            success: true, 
            to: formattedNumber,
            message: 'Mensaje enviado' 
        });
    } catch (error) {
        console.error('Error al enviar:', error);
        res.status(500).json({ error: 'Error al enviar el mensaje', details: error.message });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'running', connected: !!sock && reconnectAttempts === 0 });
});

app.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
    connectToWhatsApp();
});
