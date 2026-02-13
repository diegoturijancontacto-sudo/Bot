const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_DIR = 'auth_info';

let sock;

// Initialize WhatsApp connection
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    // Handle QR code
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('QR Code received, scan with WhatsApp:');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
            
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Connected to WhatsApp successfully!');
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
