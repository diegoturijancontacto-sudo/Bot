# WhatsApp Bot with Baileys

A simple WhatsApp bot built with Baileys library (without Puppeteer) that allows you to send messages via HTTP API.

## Features

- WhatsApp connection using Baileys
- Multi-device authentication support
- QR code displayed in terminal for easy setup
- Express REST API for sending messages
- Automatic reconnection on connection loss
- Health check endpoint

## Installation

1. Clone the repository:
```bash
git clone https://github.com/diegoturijancontacto-sudo/Bot.git
cd Bot
```

2. Install dependencies:
```bash
npm install
```

## Usage

### Starting the Bot

```bash
npm start
```

The server will start on port 3000 (or the port specified in `PORT` environment variable).

### First Time Setup

#### Option 1: Using QR Code

1. Run the bot with `npm start`
2. Scan the QR code displayed in the terminal with your WhatsApp mobile app
3. Go to WhatsApp > Settings > Linked Devices > Link a Device
4. Scan the QR code
5. Once connected, the bot is ready to receive API requests

#### Option 2: Using 8-Digit Pairing Code

1. Set your phone number as an environment variable (include country code, no + or - symbols):
   ```bash
   export PHONE_NUMBER=1234567890
   npm start
   ```
   Or on Windows:
   ```cmd
   set PHONE_NUMBER=1234567890
   npm start
   ```

2. An 8-digit pairing code will be displayed in the terminal
3. Go to WhatsApp > Settings > Linked Devices > Link a Device
4. Enter the 8-digit code shown in the terminal
5. Once connected, the bot is ready to receive API requests

**Note:** Both the QR code and pairing code (if phone number is set) will be displayed. You can use either method to connect.

### API Endpoints

#### Health Check
```
GET /
```
Returns the bot status and connection state.

#### Send Message
```
GET /send?number=<phone_number>&message=<text>
```

Parameters:
- `number`: Phone number with country code (e.g., 1234567890)
- `message`: Text message to send

Example:
```bash
curl "http://localhost:3000/send?number=1234567890&message=Hello%20World"
```

Response:
```json
{
  "success": true,
  "message": "Message sent successfully",
  "to": "1234567890"
}
```

## Configuration

- `PORT`: Set via environment variable (default: 3000)
- `AUTH_DIR`: Authentication state directory (default: auth_info)
- `PHONE_NUMBER`: Optional phone number for pairing code authentication (must include country code without + or - symbols, e.g., 1234567890)

## Dependencies

- `@whiskeysockets/baileys`: WhatsApp Web API library
- `express`: Web framework for API
- `qrcode-terminal`: QR code display in terminal
- `pino`: Logging library

## Notes

- Authentication state is saved in the `auth_info` directory
- The bot automatically reconnects if the connection is lost (unless logged out)
- Phone numbers must contain at least 10 digits
- Make sure to keep the `auth_info` directory secure and don't commit it to version control

## Troubleshooting

### 405 Method Not Allowed Error

If you encounter a "405 Method Not Allowed" or "Connection Failure" error with reason '405', this is typically due to WhatsApp servers rejecting the connection. The bot now includes several fixes:

1. **Automatic version detection** - The bot fetches the latest WhatsApp Web version for compatibility
2. **Proper browser configuration** - Uses correct browser/device identification
3. **Exponential backoff** - Retries with increasing delays (2s, 4s, 8s, 16s, 30s)
4. **Max retry limit** - Stops after 5 failed attempts to prevent endless loops

**Additional solutions:**
- Delete the `auth_info` directory and scan the QR code again
- Ensure your server/computer has a stable internet connection
- Check if WhatsApp is experiencing service issues
- Make sure you're using the latest version of the bot code

### Network Connectivity Issues

If you see `ENOTFOUND web.whatsapp.com` errors:
- Check your internet connection
- Verify that your firewall/network allows outbound WebSocket connections
- Ensure DNS resolution is working properly (`ping web.whatsapp.com`)

### Connection Keeps Dropping

The bot implements automatic reconnection with exponential backoff:
- Maximum of 5 reconnection attempts
- If max attempts are reached, restart the bot manually
- Check the logs for specific error messages