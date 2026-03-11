const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const amqplib = require('amqplib');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── State ──────────────────────────────────────────────
const QUEUE_NAME = 'orders';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const RABBITMQ_MGMT_URL = process.env.RABBITMQ_MGMT_URL || 'http://guest:guest@localhost:15672';
const PORT = process.env.PORT || 3000;

let channel = null;
let connection = null;
let emailFailure = false;
let orderCounter = 0;
const workers = new Map(); // id → { id, name, status, current, processed }
const stats = { sent: 0, processed: 0 };

// ─── Product catalog ────────────────────────────────────
const PRODUCTS = [
    { name: 'Clean Code', price: 39.99 },
    { name: 'Design Patterns', price: 49.95 },
    { name: 'Refactoring', price: 44.99 },
    { name: 'Domain-Driven Design', price: 54.95 },
    { name: 'The Pragmatic Programmer', price: 42.00 },
    { name: 'Microservices Patterns', price: 47.99 },
    { name: 'Building Microservices', price: 38.50 },
    { name: 'System Design Interview', price: 35.99 },
    { name: 'Designing Data-Intensive Apps', price: 52.00 },
    { name: 'Release It!', price: 41.95 },
];

// ─── WebSocket broadcast ────────────────────────────────
function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(msg);
    });
}

// ─── RabbitMQ connection with retry ─────────────────────
async function connectRabbitMQ(retries = 30) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`[RabbitMQ] Connecting... attempt ${i + 1}`);
            connection = await amqplib.connect(RABBITMQ_URL);
            channel = await connection.createChannel();
            await channel.assertQueue(QUEUE_NAME, { durable: true });
            console.log('[RabbitMQ] Connected!');
            return;
        } catch (err) {
            console.log(`[RabbitMQ] Not ready, retrying in 2s...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    console.error('[RabbitMQ] Failed to connect after retries');
    process.exit(1);
}

// ─── Poll queue depth ───────────────────────────────────
async function pollQueueDepth() {
    try {
        const url = `${RABBITMQ_MGMT_URL}/api/queues/%2F/${QUEUE_NAME}`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            const count = data.messages || 0;
            broadcast({ type: 'queue_depth', count });
        }
    } catch (_) { /* ignore, broker might not be ready */ }
}

// ─── REST API ───────────────────────────────────────────

// Send order
app.post('/api/send', async (req, res) => {
    if (!channel) return res.status(503).json({ error: 'RabbitMQ not connected' });

    orderCounter++;
    stats.sent++;
    const product = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
    const order = {
        id: `ORDER-${String(orderCounter).padStart(4, '0')}`,
        product: product.name,
        amount: product.price,
        timestamp: new Date().toISOString(),
        emailFailure
    };

    channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(order)), { persistent: true });

    broadcast({ type: 'order_sent', order, stats: { ...stats, queued: stats.sent - stats.processed } });
    broadcast({ type: 'order_queued', order });

    res.json({ ok: true, order });
});

// Toggle email failure
app.post('/api/toggle-failure', (_req, res) => {
    emailFailure = !emailFailure;
    broadcast({ type: 'email_failure', active: emailFailure });
    res.json({ emailFailure });
});

// Set email failure explicitly
app.post('/api/set-failure', (req, res) => {
    emailFailure = !!req.body.active;
    broadcast({ type: 'email_failure', active: emailFailure });
    res.json({ emailFailure });
});

// Worker register
app.post('/api/worker/register', (req, res) => {
    const { id, name } = req.body;
    workers.set(id, { id, name, status: 'idle', current: null, processed: 0 });
    broadcast({ type: 'consumer_update', workers: Array.from(workers.values()) });
    console.log(`[Worker] ${name} registered`);
    res.json({ ok: true });
});

// Worker update
app.post('/api/worker/update', (req, res) => {
    const { id, status, current, processed } = req.body;
    const w = workers.get(id);
    if (w) {
        w.status = status;
        w.current = current;
        if (processed !== undefined) w.processed = processed;
        broadcast({ type: 'consumer_update', workers: Array.from(workers.values()) });

        if (status === 'processing' && current) {
            broadcast({ type: 'order_processing', order: current, workerId: id, workerName: w.name });
        }
        if (status === 'idle' && current) {
            stats.processed++;
            broadcast({ type: 'order_done', order: current, workerId: id, workerName: w.name, stats: { ...stats, queued: stats.sent - stats.processed } });
        }
    }
    res.json({ ok: true });
});

// Worker leave
app.post('/api/worker/leave', (req, res) => {
    const { id } = req.body;
    const w = workers.get(id);
    if (w) console.log(`[Worker] ${w.name} left`);
    workers.delete(id);
    broadcast({ type: 'consumer_update', workers: Array.from(workers.values()) });
    res.json({ ok: true });
});

// Get current state
app.get('/api/state', (_req, res) => {
    res.json({
        emailFailure,
        stats: { ...stats, queued: stats.sent - stats.processed },
        workers: Array.from(workers.values())
    });
});

// Reset demo
app.post('/api/reset', async (_req, res) => {
    stats.sent = 0;
    stats.processed = 0;
    orderCounter = 0;
    // Purge the queue
    try { if (channel) await channel.purgeQueue(QUEUE_NAME); } catch (_) { }
    // Reset worker counters
    workers.forEach(w => { w.processed = 0; w.current = null; w.status = 'idle'; });
    broadcast({ type: 'reset' });
    broadcast({ type: 'consumer_update', workers: Array.from(workers.values()) });
    broadcast({ type: 'queue_depth', count: 0 });
    console.log('[Demo] Reset!');
    res.json({ ok: true });
});

// ─── Start ──────────────────────────────────────────────
(async () => {
    await connectRabbitMQ();
    setInterval(pollQueueDepth, 500);

    server.listen(PORT, () => {
        console.log(`\n🚀 Async Messaging Demo running at http://localhost:${PORT}`);
        console.log(`📊 RabbitMQ Management: http://localhost:15672`);
        console.log(`\nUse in separate terminals:`);
        console.log(`  node consumer.js Worker-1`);
        console.log(`  node consumer.js Worker-2\n`);
    });
})();
