# WhatsApp Bot with Baileys

A simple WhatsApp bot built with Baileys library (without Puppeteer) that allows you to send messages via HTTP API. Authentication state is stored in MongoDB for persistence and scalability.

## Features

- WhatsApp connection using Baileys
- Multi-device authentication support
- **MongoDB-based authentication storage** (no local files)
- QR code displayed in terminal for easy setup
- Express REST API for sending messages
- **Support for sending messages to both individuals and groups**
- Automatic reconnection on connection loss
- Health check endpoint

## Prerequisites

- Node.js (v14 or higher)
- MongoDB database (local or cloud, e.g., MongoDB Atlas)

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

3. Set up environment variables:

**Required:**
- `MONGO_URL`: Your MongoDB connection string

**Optional:**
- `PORT`: Server port (default: 3000)
- `PHONE_NUMBER`: Phone number for pairing code authentication

Example:
```bash
export MONGO_URL="mongodb://localhost:27017/whatsapp_bot"
export PORT=3000
export PHONE_NUMBER=1234567890
```

Or create a `.env` file:
```
MONGO_URL=mongodb://localhost:27017/whatsapp_bot
PORT=3000
PHONE_NUMBER=1234567890
```

**MongoDB Atlas Example:**
```
MONGO_URL=mongodb+srv://username:password@cluster.mongodb.net/whatsapp_bot?retryWrites=true&w=majority
```

## Usage

### Starting the Bot

```bash
npm start
```

The server will start on port 3000 (or the port specified in `PORT` environment variable).

**Note:** The bot requires the `MONGO_URL` environment variable to be set. If not provided, the bot will exit with an error message.

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
GET /send?number=<phone_number_or_group_id>&message=<text>
```

Parameters:
- `number`: Phone number with country code (e.g., 1234567890) OR WhatsApp group ID (e.g., 1234567890-1234567890 or 1234567890-1234567890@g.us)
- `message`: Text message to send

**Example - Send to Individual:**
```bash
curl "http://localhost:3000/send?number=1234567890&message=Hello%20World"
```

Response:
```json
{
  "success": true,
  "message": "Message sent successfully",
  "to": "1234567890",
  "type": "individual"
}
```

**Example - Send to Group:**
```bash
curl "http://localhost:3000/send?number=1234567890-1234567890&message=Hello%20Group"
```

Response:
```json
{
  "success": true,
  "message": "Message sent successfully",
  "to": "1234567890-1234567890",
  "type": "group"
}
```

**Getting Group ID:**
To get a group ID, you can:
1. Use WhatsApp Web developer tools to inspect group messages
2. Forward a message from the group and check the metadata
3. Use Baileys methods to list groups programmatically (the bot owner must be a member)

## Configuration

Environment Variables:
- `MONGO_URL`: **[Required]** MongoDB connection string (e.g., `mongodb://localhost:27017/whatsapp_bot` or MongoDB Atlas URI)
- `PORT`: Server port (default: 3000)
- `PHONE_NUMBER`: Optional phone number for pairing code authentication (must include country code without + or - symbols, e.g., 1234567890)

## MongoDB Storage

The bot stores authentication credentials in MongoDB instead of local files:
- **Database**: `whatsapp_bot`
- **Collection**: `auth`
- **Benefits**:
  - No local file storage needed
  - Easy deployment on cloud platforms (e.g., Render, Heroku)
  - Shared authentication across multiple instances
  - Better persistence and reliability

The MongoDB collection stores authentication keys with the following structure:
```
{
  _id: "key_name",
  value: "serialized_json_data"
}
```

## Dependencies

- `@whiskeysockets/baileys`: WhatsApp Web API library
- `express`: Web framework for API
- `qrcode-terminal`: QR code display in terminal
- `pino`: Logging library
- `mongodb`: MongoDB driver for authentication storage

## Notes

- Authentication state is saved in MongoDB (database: `whatsapp_bot`, collection: `auth`)
- The bot automatically reconnects if the connection is lost (unless logged out)
- Phone numbers must contain at least 10 digits
- Group IDs typically follow the format `1234567890-1234567890` (with or without `@g.us` suffix)
- The bot must be a member of a group to send messages to it
- Make sure your MongoDB connection is secure and use authentication
- **No local files**: The `auth_info` directory is no longer used

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