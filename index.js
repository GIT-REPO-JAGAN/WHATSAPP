/**
 * WhatsApp Translation Bot
 * Any Language → English
 * Uses Groq Llama-3.1-8b-instant
 */

import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import axios from "axios";
import dotenv from "dotenv";
import qrcode from "qrcode-terminal";

dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.MODEL;

if (!GROQ_API_KEY) {
    console.error("❌ ERROR: GROQ_API_KEY missing in .env file");
    process.exit(1);
}

// --------------------------------------------------------
// GROQ TRANSLATION FUNCTION
// --------------------------------------------------------
async function translateWithGroq(text) {
    try {
        const body = {
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: `If the text is already English, reply only: SAME
If NOT English, reply ONLY the English translation.`
                },
                {
                    role: "user",
                    content: text
                }
            ]
        };

        const res = await axios.post(
            "https://api.groq.com/v1/chat/completions",
            body,
            {
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return res.data.choices[0].message.content.trim();
    } catch (err) {
        console.error("Groq Error:", err.message);
        return null;
    }
}

// --------------------------------------------------------
// EXTRACT TEXT FROM MESSAGE
// --------------------------------------------------------
function extractText(msg) {
    let m = msg.message;
    if (!m) return null;

    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;
    return null;
}

// --------------------------------------------------------
// START BOT
// --------------------------------------------------------
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");

    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: state
    });

    // SAVE CREDS
    sock.ev.on("creds.update", saveCreds);

    // QR CODE HANDLING
    sock.ev.on("connection.update", (update) => {
        const { connection, qr } = update;

        if (qr) {
            console.log("\n📱 SCAN THIS QR CODE WITH YOUR WHATSAPP → Linked Devices\n");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "open") {
            console.log("✅ WhatsApp BOT CONNECTED & RUNNING");
        }
        if (connection === "close") {
            console.log("❌ Connection closed. Restarting required.");
        }
    });

    // MESSAGE HANDLER
    sock.ev.on("messages.upsert", async ({ messages }) => {
        let msg = messages[0];

        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;

        // only groups
        if (!chatId.endsWith("@g.us")) return;

        const text = extractText(msg);
        if (!text) return;

        console.log("📩 Received:", text);

        // Translate using Groq
        const translated = await translateWithGroq(text);

        if (!translated) return;

        if (translated === "SAME") {
            console.log("English detected → no action.");
            return;
        }

        // Send translation
        await sock.sendMessage(chatId, {
            text: `🌐 *Translated to English:*\n${translated}`
        });

        console.log("➡️ Sent translation:", translated);
    });
}

startBot();
