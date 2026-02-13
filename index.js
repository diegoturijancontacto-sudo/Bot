const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_DIR = 'auth_info';

let sock;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Initialize WhatsApp connection
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
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
        browser: ['WhatsApp Bot', 'Chrome', '10.0'],
        getMessage: async (key) => {
            return { conversation: '' };
        }
    });

    // Handle QR code
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('QR Code received, scan with WhatsApp:');
            qrcode.generate(qr, { small: true });
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

// Express route to send messages
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
    
    try {
        // Format number to include country code if not present
        const formattedNumber = number.replace(/[^\d]/g, '');
        
        // Validate phone number
        if (!formattedNumber || formattedNumber.length < 10) {
            return res.status(400).json({ 
                error: 'Invalid phone number. Must contain at least 10 digits.' 
            });
        }
        
        // Add @s.whatsapp.net suffix
        const jid = formattedNumber + '@s.whatsapp.net';
        
        await sock.sendMessage(jid, { text: message });
        
        res.json({ 
            success: true, 
            message: 'Message sent successfully',
            to: formattedNumber
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ 
            error: 'Failed to send message', 
            details: error.message 
        });
    }
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
