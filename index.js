// index.js
const { makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const NodeCache = require('node-cache');
const qrcode = require('qrcode-terminal');
const util = require('util');
const cron = require('node-cron');
const { getData, setData, updateData, deleteData, addTask, getAllTasks } = require('./firebaseService');

let qrCode = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

// Setup logging
const log_file = fs.createWriteStream(__dirname + '/debug.log', { flags: 'a' });
const logToFile = (data) => log_file.write(util.format(data) + '\n');

// Decode message helper
const decodeMessage = (message) => (typeof message === 'string' ? Buffer.from(message, 'utf-8').toString() : message);

// Query Flowise AI API
const query = async (data, sessionId) => {
  try {
    const response = await fetch("https://flowisefrest.onrender.com/api/v1/prediction/e5d4a781-a3a5-4631-8cdd-3972b57bcba7", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, overrideConfig: { sessionId } })
    });
    return await response.json();
  } catch (error) {
    console.error('Error saat melakukan query:', error);
    logToFile('Error saat melakukan query: ' + error.message);
    throw error;
  }
};

// Send message with retries
const sendMessageWithRetry = async (socket, phone, message) => {
  try {
    await socket.sendMessage(phone, message);
  } catch (error) {
    console.error('Error saat mengirim pesan:', error);
    logToFile('Error saat mengirim pesan: ' + error.message);
    throw error;
  }
};

// Calculate remaining days
const calculateRemainingDays = (deadline) => {
  const currentDate = new Date();
  const [day, month] = deadline.split('.').map(Number);
  const deadlineDate = new Date(currentDate.getFullYear(), month - 1, day);
  
  if (deadlineDate < currentDate) {
    return 0;
  }
  
  const diffTime = deadlineDate - currentDate;
  const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return isNaN(remainingDays) ? 'Invalid date' : remainingDays;
};

// Connect to WhatsApp
const connectWhatsapp = async () => {
  try {
    console.log('Memulai koneksi WhatsApp...');
    logToFile('Memulai koneksi WhatsApp...');
    const auth = await useMultiFileAuthState("sessionDir");
    const msgRetryCounterCache = new NodeCache();

    const socket = makeWASocket({
      printQRInTerminal: false,
      browser: ["DAPABOT", "", ""],
      auth: auth.state,
      logger: pino({ level: "silent" }),
      msgRetryCounterMap: msgRetryCounterCache,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      retryRequestDelayMs: 5000,
      patchMessageBeforeSending: (message) => {
        const requiresPatch = !!(
          message.buttonsMessage ||
          message.templateMessage ||
          message.listMessage
        );
        if (requiresPatch) {
          message = {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {},
                },
                ...message,
              },
            },
          };
        }
        return message;
      },
    });

    socket.ev.on("creds.update", auth.saveCreds);

    socket.ev.on("connection.update", ({ connection, qr }) => {
      if (connection === 'open') {
        console.log("WhatsApp Active..");
        console.log('Bot ID:', socket.user.id);
        logToFile("WhatsApp Active..");
        logToFile('Bot ID: ' + socket.user.id);
        qrCode = null;
        reconnectAttempts = 0;
      } else if (connection === 'close') {
        console.log("WhatsApp Closed..");
        logToFile("WhatsApp Closed..");
        
      } else if (connection === 'connecting') {
        console.log('WhatsApp Connecting');
        logToFile('WhatsApp Connecting');
      }
      if (qr) {
        console.log('New QR Code received');
        logToFile('New QR Code received');
        qrcode.generate(qr, { small: true });
        qrCode = qr;
      }
    });

    socket.ev.on("messages.upsert", async ({ messages }) => {
      try {
        const message = messages[0];
        console.log('Raw message:', JSON.stringify(message, null, 2));
        logToFile('Raw message: ' + JSON.stringify(message, null, 2));

        let pesan = '';
        let isGroupMessage = message.key.remoteJid.endsWith('@g.us');
        let isMentioned = false;

        if (message.message && message.message.conversation) {
          pesan = decodeMessage(message.message.conversation);
        } else if (message.message && message.message.extendedTextMessage && message.message.extendedTextMessage.text) {
          pesan = decodeMessage(message.message.extendedTextMessage.text);
        } else {
          console.log('Unsupported message type');
          logToFile('Unsupported message type');
          return;
        }

        const senderNumber = message.key.participant || message.key.remoteJid;
        const botNumber = socket.user.id.split(':')[0];
        isMentioned = pesan.includes(`@${botNumber}`);
        
        // Remove sender number and bot number from message
        if (isMentioned) {
          pesan = pesan.replace(`@${botNumber}`, '').trim();
        }
        pesan = pesan.replace(`@${senderNumber}`, '').trim();

        const phone = message.key.remoteJid;
        console.log('Decoded message:', pesan);
        logToFile('Decoded message: ' + pesan);
        console.log('Is Group Message:', isGroupMessage);
        console.log('Is Mentioned:', isMentioned);

        // Process message only if it's not from the bot and if it's a group message, the bot must be mentioned
        if (!message.key.fromMe) {
          if (!isGroupMessage || (isGroupMessage && isMentioned)) {
            console.log('Processing message. isGroupMessage:', isGroupMessage, 'isMentioned:', isMentioned);
            logToFile(`Processing message. isGroupMessage: ${isGroupMessage}, isMentioned: ${isMentioned}`);

            const sessionId = phone; // Menggunakan remoteJid sebagai sessionId

            if (pesan.startsWith('.tugas ')) {
              const content = pesan.replace('.tugas ', '').trim();
              if (content.toLowerCase() === 'info') {
                const tasks = await getAllTasks();
                let response = 'Daftar tugas:\n';
                for (const key in tasks) {
                  const task = tasks[key];
                  const remainingDays = calculateRemainingDays(task.deadline);
                  response += `- ${task.dosen}: ${task.namaTugas} sisa: ${remainingDays} hari\n`;
                }
                await sendMessageWithRetry(socket, phone, { text: response });
              } else {
                const [dosen, namaTugas, deadline] = content.split(',').map(item => item.trim());
                if (dosen && namaTugas && deadline) {
                  const dateRegex = /^(\d{2})\.(\d{2})$/;
                  if (dateRegex.test(deadline)) {
                    await addTask(dosen, namaTugas, deadline, sessionId);
                    await sendMessageWithRetry(socket, phone, { text: 'Tugas berhasil ditambahkan.' });
                  } else {
                    await sendMessageWithRetry(socket, phone, { text: 'Format tanggal tidak valid. Gunakan format DD.MM' });
                  }
                } else {
                  await sendMessageWithRetry(socket, phone, { text: 'Format tidak valid. Gunakan: .tugas (dosen), (nama tugas), (deadline dalam format DD.MM)' });
                }
              }
            } else {
              const response = await query({ question: pesan }, sessionId);
              console.log('Flowise response:', response);
              logToFile('Flowise response: ' + JSON.stringify(response));
              const { text } = response;
              await sendMessageWithRetry(socket, phone, { text: text });
            }
          }
        }
      } catch (error) {
        console.error('Error saat memproses pesan:', error);
        logToFile('Error saat memproses pesan: ' + error.message);
      }
    });

    const checkDeadlines = async () => {
      const tasks = await getAllTasks();
      const now = new Date();
      for (const key in tasks) {
        const task = tasks[key];
        const remainingDays = calculateRemainingDays(task.deadline);
        if (remainingDays <= 3 && remainingDays > 0) {
          const reminderMessage = `Reminder: Tugas dari ${task.dosen} ${task.namaTugas} akan berakhir pada ${remainingDays} hari.`;
          await sendMessageWithRetry(socket, task.sessionId, { text: reminderMessage });
        }
      };
      const currentDate = new Date();
      const currentDay = currentDate.getDate();
      const currentMonth = currentDate.getMonth() + 1; // Bulan dimulai dari 0 di JavaScript
      for (const key in tasks) {
        const task = tasks[key];
        const [day, month] = task.deadline.split('.').map(Number);

        // Hapus tugas jika deadline sudah mencapai 0 hari
        if (month === currentMonth && day - currentDay <= 0) {
          await deleteData(`tugas/${key}`);
          console.log('Tugas dihapus karena deadline sudah tercapai:', task);
        }
      }
    };

    cron.schedule('30 18 * * *', checkDeadlines, {
      timezone: "Asia/Jakarta"
    }); // jadwal chek dedline setiap hari
    
  } catch (error) {
    console.error("Error saat menghubungkan ke WhatsApp:", error);
    logToFile("Error saat menghubungkan ke WhatsApp: " + error.message);
  }
};
// Mulai koneksi WhatsApp
module.exports = { connectWhatsapp };
