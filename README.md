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

1. Run the bot with `npm start`
2. Scan the QR code displayed in the terminal with your WhatsApp mobile app
3. Go to WhatsApp > Settings > Linked Devices > Link a Device
4. Scan the QR code
5. Once connected, the bot is ready to receive API requests

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