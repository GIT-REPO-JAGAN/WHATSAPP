/**
 * index.js
 * WhatsApp Group Translator Bot (Any language -> English)
 * Uses: Baileys (WhatsApp Web), Groq chat completions (MODEL from .env)
 *
 * Behavior:
 * - Listens only to group messages
 * - Sends message to Groq asking: "If already English reply EXACTLY 'SAME', otherwise reply only with English translation"
 * - If Groq replies 'SAME' -> bot does nothing
 * - If Groq replies translation -> bot posts the English translation to the group
 *
 * NOTE:
 * - Scan the QR (terminal) with the WhatsApp account you want the bot to run as.
 * - If you want the bot to be a member of TESTGROUP, add that WhatsApp account to the group.
 */

import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.MODEL || "llama-3.1-8b-instant";

if (!GROQ_API_KEY) {
  console.error("Missing GROQ_API_KEY in .env. Please add it and restart.");
  process.exit(1);
}

async function translateWithGroq(text) {
  try {
    const systemPrompt = `You are a translation assistant. If the provided text is already English, respond with the single word:
SAME

If the text is not English, respond ONLY with the English translation and nothing else. Do not add explanations.`;

    const payload = {
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ],
      // max_tokens etc can be added if needed
    };

    const res = await axios.post(
      "https://api.groq.com/v1/chat/completions",
      payload,
      {
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );

    const content = res?.data?.choices?.[0]?.message?.content;
    if (!content) return null;
    return content.trim();
  } catch (err) {
    console.error("Groq API error:", err?.response?.data || err.message);
    return null;
  }
}

function extractTextFromMessage(msg) {
  // supports normal text and extended text and image captions
  const m = msg?.message;
  if (!m) return null;

  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.documentMessage?.caption) return m.documentMessage.caption;
  return null;
}

async function start() {
  // keep auth files in ./auth_info
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [4, 26, 1] }));
  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("Connection closed. If you see a QR again, scan it. Reason:", lastDisconnect?.error?.message || reason);
    } else if (connection === "open") {
      console.log("✅ WhatsApp connection opened.");
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    try {
      const messages = m?.messages || [];
      if (!messages.length) return;

      const msg = messages[0];
      if (!msg.message) return;
      if (msg.key.fromMe) return; // ignore messages sent by this logged-in account

      const remoteJid = msg.key.remoteJid || "";
      // only handle group messages
      if (!remoteJid.endsWith("@g.us")) return;

      const text = extractTextFromMessage(msg);
      if (!text) return;

      console.log("Received message in group:", remoteJid, "text:", text);

      // Call Groq to decide & translate
      const groqReply = await translateWithGroq(text);

      if (!groqReply) {
        console.log("No reply from Groq or error — skipping.");
        return;
      }

      if (groqReply === "SAME") {
        console.log("Message already English — doing nothing.");
        return;
      }

      // Otherwise send the translated English text back to the group
      const replyText = `🌐 *Translated to English:*\n${groqReply}`;
      await sock.sendMessage(remoteJid, { text: replyText });
      console.log("Sent translation to group.");
    } catch (e) {
      console.error("Error handling message:", e);
    }
  });

  console.log("Bot started — scan the QR code in this terminal with the WhatsApp account you want the bot to run as.");
}

start().catch(err => {
  console.error("Fatal error starting bot:", err);
});
