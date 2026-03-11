#!/usr/bin/env node
const amqplib = require('amqplib');

const QUEUE_NAME = 'orders';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

const workerName = process.argv[2] || `Worker-${Math.floor(Math.random() * 1000)}`;
const speedMs = parseInt(process.argv[3]) || 1000;
const workerId = `${workerName}-${Date.now()}`;

let processed = 0;
let channel = null;
let connection = null;

// ─── HTTP helper ────────────────────────────────────────
async function postToServer(endpoint, body) {
    try {
        await fetch(`${SERVER_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (_) { /* server might not be up yet */ }
}

// ─── Graceful shutdown ──────────────────────────────────
async function shutdown() {
    console.log(`\n🛑 ${workerName} shutting down...`);
    await postToServer('/api/worker/leave', { id: workerId });
    try {
        if (channel) await channel.close();
        if (connection) await connection.close();
    } catch (_) { }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ─── Main ───────────────────────────────────────────────
(async () => {
    console.log(`\n🔧 Consumer: ${workerName}`);
    console.log(`   Speed: ${speedMs}ms per message`);
    console.log(`   Queue: ${QUEUE_NAME}`);
    console.log(`   Broker: ${RABBITMQ_URL}\n`);

    // Connect to RabbitMQ with retry
    for (let i = 0; i < 30; i++) {
        try {
            connection = await amqplib.connect(RABBITMQ_URL);
            break;
        } catch (_) {
            console.log(`   Waiting for RabbitMQ... (attempt ${i + 1})`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    if (!connection) {
        console.error('❌ Could not connect to RabbitMQ');
        process.exit(1);
    }

    channel = await connection.createChannel();
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    channel.prefetch(1); // fair dispatch

    // Register with server
    await postToServer('/api/worker/register', { id: workerId, name: workerName });

    console.log(`✅ ${workerName} ready. Waiting for messages...\n`);

    channel.consume(QUEUE_NAME, async (msg) => {
        if (!msg) return;

        const order = JSON.parse(msg.content.toString());
        console.log(`  📦 Processing: ${order.id} — ${order.product}`);

        // Report processing
        await postToServer('/api/worker/update', {
            id: workerId,
            status: 'processing',
            current: order,
            processed
        });

        // Simulate work
        await new Promise(r => setTimeout(r, speedMs));

        processed++;
        channel.ack(msg);

        console.log(`  ✅ Done: ${order.id} (total: ${processed})`);

        // Report done
        await postToServer('/api/worker/update', {
            id: workerId,
            status: 'idle',
            current: order,
            processed
        });
    });
})();
