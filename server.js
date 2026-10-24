const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode-terminal');

const app = express();

// Enable clean CORS support for local frontend requests
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

let waSock = null;
let isConnected = false;
const activeOtps = new Map(); // Stores phone -> OTP mapping in memory

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_session');

        waSock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ['Mysticers OTP Bot', 'Chrome', '1.0.0']
        });

        waSock.ev.on('creds.update', saveCreds);

        waSock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('\n==================================================');
                console.log('SCAN THIS QR CODE WITH YOUR WHATSAPP APP:');
                console.log('==================================================\n');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                isConnected = false;
                const statusCode = (lastDisconnect?.error)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`[BOT STATUS] Connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`);
                if (shouldReconnect) {
                    setTimeout(connectToWhatsApp, 3000); // Wait 3s before reconnecting
                }
            } else if (connection === 'open') {
                isConnected = true;
                console.log('\n==================================================');
                console.log(' SUCCESS: WhatsApp Bot is Connected and Ready!');
                console.log('==================================================\n');
            }
        });
    } catch (err) {
        console.error('[BOT ERROR] Failed during WhatsApp initialization:', err.message);
        setTimeout(connectToWhatsApp, 5000);
    }
}

connectToWhatsApp();

// 1. Endpoint to Generate & Auto-Send OTP via WhatsApp
app.post('/api/send-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) {
            return res.status(400).json({ success: false, error: 'Phone number is required.' });
        }

        if (!waSock || !isConnected) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp Bot is offline. Please scan the QR code in the terminal.'
            });
        }

        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            return res.status(400).json({ success: false, error: 'Invalid phone number format.' });
        }

        // Generate 4-digit code
        const otpCode = Math.floor(1000 + Math.random() * 9000).toString();

        // Save in memory for 5 minutes
        activeOtps.set(cleanPhone, otpCode);
        setTimeout(() => activeOtps.delete(cleanPhone), 5 * 60 * 1000);

        const formattedJid = `91${cleanPhone.slice(-10)}@s.whatsapp.net`;
        const messageText = `🔒 *MYSTICERS HUB VERIFICATION*\n\nYour security OTP code is: *${otpCode}*\n\nValid for 5 minutes. Do not share this PIN with anyone.`;

        await waSock.sendMessage(formattedJid, { text: messageText });
        console.log(`[OTP DELIVERED] Code ${otpCode} sent to +91${cleanPhone}`);

        return res.json({ success: true, message: 'OTP sent directly to WhatsApp.' });
    } catch (err) {
        console.error('[SEND ERROR]', err.message);
        return res.status(500).json({ success: false, error: 'Failed to deliver message via WhatsApp API.' });
    }
});

// 2. Endpoint to Verify OTP Code
app.post('/api/verify-otp', (req, res) => {
    try {
        const { phone, otp } = req.body;
        if (!phone || !otp) {
            return res.status(400).json({ success: false, error: 'Phone and OTP are required.' });
        }

        const cleanPhone = phone.replace(/\D/g, '');
        const validOtp = activeOtps.get(cleanPhone);

        if (validOtp && validOtp === otp.trim()) {
            activeOtps.delete(cleanPhone); // Prevent single-code reuse
            return res.json({ success: true, message: 'Authentication successful.' });
        }

        return res.status(400).json({ success: false, error: 'Invalid or expired OTP code.' });
    } catch (err) {
        console.error('[VERIFY ERROR]', err.message);
        return res.status(500).json({ success: false, error: 'Internal verification server error.' });
    }
});

app.listen(5000, () => console.log('OTP Bot Backend listening smoothly on http://localhost:5000'));