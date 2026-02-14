const { 
    default: makeWASocket, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const { useMongoDBAuthState } = require('@whiskeysockets/baileys-mongodb');
const { MongoClient } = require('mongodb');
const express = require('express');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;
const PHONE_NUMBER = process.env.PHONE_NUMBER || ''; // Número para Pairing Code (ej: 521234567890)
const MONGO_URL = process.env.MONGO_URL; // URL de conexión a MongoDB de Render

let sock;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Inicializa la conexión de WhatsApp con persistencia en MongoDB
 */
async function connectToWhatsApp() {
    if (!MONGO_URL) {
        console.error('ERROR: La variable de entorno MONGO_URL no está configurada.');
        process.exit(1);
    }

    // 1. Conexión a MongoDB
    const mongoClient = new MongoClient(MONGO_URL);
    await mongoClient.connect();
    console.log('Conectado a MongoDB correctamente.');
    
    const collection = mongoClient.db("whatsapp_bot").collection("auth");

    // 2. Usar MongoDB para guardar el estado de la sesión
    const { state, saveCreds } = await useMongoDBAuthState(collection);
    
    // Obtener la última versión de Baileys para evitar problemas de compatibilidad
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Usando WA v${version.join('.')}, última versión: ${isLatest}`);
    
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

    // Lógica para solicitar Pairing Code si el número está configurado y no hay sesión
    if (PHONE_NUMBER && !state.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('🔐 CÓDIGO DE EMPAREJAMIENTO (8 dígitos):');
                console.log('   ' + code);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('Para conectar:');
                console.log('1. Abre WhatsApp en tu teléfono');
                console.log('2. Ve a Configuración > Dispositivos vinculados');
                console.log('3. Toca en "Vincular un dispositivo"');
                console.log('4. Toca en "Vincular con el número de teléfono" e ingresa el código');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            } catch (error) {
                console.error('Error al solicitar Pairing Code:', error.message);
            }
        }, 5000); // Esperar a que el socket esté listo
    }

    // Manejo de actualizaciones de conexión
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📱 Código QR recibido, escanea con WhatsApp:');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            qrcode.generate(qr, { small: true });
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log('Conexión cerrada. Razón:', lastDisconnect?.error?.message, '| Reintentar:', shouldReconnect);
            
            if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                console.log(`Reintentando conexión (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) en ${delay}ms...`);
                setTimeout(() => connectToWhatsApp(), delay);
            } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                console.error('Máximo de intentos de reconexión alcanzado.');
            }
        } else if (connection === 'open') {
            console.log('¡Conectado a WhatsApp exitosamente!');
            reconnectAttempts = 0; 
        }
    });

    // Guardar credenciales en MongoDB automáticamente
    sock.ev.on('creds.update', saveCreds);
}

/** * API Endpoint: Enviar Mensajes
 * Ejemplo: /send?number=521234567890&message=Hola
 */
app.get('/send', async (req, res) => {
    const { number, message } = req.query;
    
    if (!number || !message) {
        return res.status(400).json({ error: 'Faltan parámetros: number y message' });
    }
    
    if (!sock) {
        return res.status(500).json({ error: 'La conexión de WhatsApp no está activa' });
    }
    
    try {
        let jid;
        let isGroup = false;
        
        // Lógica de detección de Grupo vs Individual
        if (number.includes('@g.us')) {
            jid = number;
            isGroup = true;
        } else {
            const cleaned = number.replace(/[^\d-]/g, '');
            const groupIdMatch = cleaned.match(/^(\d{10,})-(\d{10,})$/);
            
            if (groupIdMatch) {
                jid = cleaned + '@g.us';
                isGroup = true;
            } else {
                const formattedNumber = number.replace(/[^\d]/g, '');
                if (formattedNumber.length < 10) {
                    return res.status(400).json({ error: 'Número de teléfono inválido' });
                }
                jid = formattedNumber + '@s.whatsapp.net';
            }
        }
        
        await sock.sendMessage(jid, { text: message });
        
        res.json({ 
            success: true, 
            message: 'Mensaje enviado',
            to: jid,
            type: isGroup ? 'group' : 'individual'
        });
    } catch (error) {
        console.error('Error al enviar mensaje:', error);
        res.status(500).json({ error: 'Error al enviar', details: error.message });
    }
});

// Endpoint de estado
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        whatsapp_connected: !!sock?.user 
    });
});

// Iniciar servidor Express
app.listen(PORT, () => {
    console.log(`Servidor HTTP en puerto ${PORT}`);
    connectToWhatsApp();
});
