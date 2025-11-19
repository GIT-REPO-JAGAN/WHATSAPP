/**
 * WhatsApp Translation Bot - Baileys 6.5.0 Compatible
 * Any Language → English using Groq API
 */

import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import axios from "axios";
import dotenv from "dotenv";
import qrcode from "qrcode-terminal";

dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.MODEL;

if (!GROQ_API_KEY) {
    console.log("❌ ERROR: Add GROQ_API_KEY in .env first");
    process.exit(1);
}

//-------------------------------------------------------------
// GROQ TRANSLATION
//-------------------------------------------------------------
async function translateToEnglish(text) {
    try {
        const response = await axios.post(
            "https://api.groq.com/v1/chat/completions",
            {
                model: MODEL,
                messages: [
                    {
                        role: "system",
                        content:
                            "If text is already English reply only 'SAME'. If not English, reply only English translation."
                    },
                    { role: "user", content: text }
                ]
            },
            {
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error("Groq API Error:", error.message);
        return null;
    }
}

//-------------------------------------------------------------
// Extract text from WhatsApp message
//-------------------------------------------------------------
function extractMessage(msg) {
    const m = msg?.message;
    if (!m) return null;

    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;

    return null;
}

//-------------------------------------------------------------
// START BOT
//-------------------------------------------------------------
async function startBot() {
    console.log("🚀 Starting WhatsApp Translation Bot (Baileys 6.5.0)...");

    const { state, saveCreds } = await useMultiFileAuthState("auth_info");

    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false
    });

    // Save session
    sock.ev.on("creds.update", saveCreds);

    // Handle QR Code
    sock.ev.on("connection.update", (update) => {
        const { connection, qr } = update;

        if (qr) {
            console.log("\n📱 SCAN THIS QR WITH WHATSAPP → Linked Devices\n");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "open") {
            console.log("✅ BOT CONNECTED SUCCESSFULLY!");
        }

        if (connection === "close") {
            console.log("❌ Connection closed. Restart bot.");
        }
    });

    // Handle Messages
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const chatId = msg.key.remoteJid;

        // Only respond inside group chats
        if (!chatId.endsWith("@g.us")) return;

        if (msg.key.fromMe) return;

        const text = extractMessage(msg);
        if (!text) return;

        console.log("📩 Incoming:", text);

        // Translation
        const result = await translateToEnglish(text);

        if (!result) return;

        if (result === "SAME") {
            console.log("English detected → No translation.");
            return;
        }

        await sock.sendMessage(chatId, {
            text: `🌐 *Translated to English:*\n${result}`
        });

        console.log("➡️ Sent translation:", result);
    });
}

startBot();
