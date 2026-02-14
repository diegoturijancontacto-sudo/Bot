const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_DIR = 'auth_info';
const PHONE_NUMBER = process.env.PHONE_NUMBER || ''; // Phone number for pairing code (with country code, no + or -)

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
        let jid;
        let recipientId;
        let isGroup = false;
        
        // Check if it's a group ID
        // Group IDs have format: 1234567890-1234567890@g.us or 1234567890-1234567890
        // They consist of exactly two sets of digits separated by a single dash
        if (number.includes('@g.us')) {
            // Group ID already formatted
            jid = number;
            recipientId = number;
            isGroup = true;
        } else {
            // Clean the input - remove all non-digit and non-dash characters
            const cleaned = number.replace(/[^\d-]/g, '');
            
            // Check if it matches group ID pattern: exactly one dash with digits on both sides
            // Group IDs typically have format like 1234567890-1234567890 (at least 10 digits on each side)
            const groupIdMatch = cleaned.match(/^(\d{10,})-(\d{10,})$/);
            
            if (groupIdMatch) {
                // It's a group ID
                jid = cleaned + '@g.us';
                recipientId = cleaned;
                isGroup = true;
            } else {
                // Regular phone number - remove all non-digits including dashes
                const formattedNumber = number.replace(/[^\d]/g, '');
                
                // Validate phone number
                if (!formattedNumber || formattedNumber.length < 10) {
                    return res.status(400).json({ 
                        error: 'Invalid phone number. Must contain at least 10 digits.' 
                    });
                }
                
                jid = formattedNumber + '@s.whatsapp.net';
                recipientId = formattedNumber;
            }
        }
        
        await sock.sendMessage(jid, { text: message });
        
        res.json({ 
            success: true, 
            message: 'Message sent successfully',
            to: recipientId,
            type: isGroup ? 'group' : 'individual'
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
