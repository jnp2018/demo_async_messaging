#!/usr/bin/env node
const amqplib = require('amqplib');

const QUEUE_NAME = 'orders';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

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

const count = parseInt(process.argv[2]) || 5;
const delayMs = parseInt(process.argv[3]) || 200;

(async () => {
    console.log(`📤 Sending ${count} orders (delay: ${delayMs}ms)...\n`);

    const conn = await amqplib.connect(RABBITMQ_URL);
    const ch = await conn.createChannel();
    await ch.assertQueue(QUEUE_NAME, { durable: true });

    for (let i = 1; i <= count; i++) {
        const product = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
        const order = {
            id: `ORDER-${String(Date.now()).slice(-4)}-${i}`,
            product: product.name,
            amount: product.price,
            timestamp: new Date().toISOString()
        };

        ch.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(order)), { persistent: true });
        console.log(`  [${i}/${count}] ${order.id} — ${order.product} ($${order.amount})`);

        if (i < count) await new Promise(r => setTimeout(r, delayMs));
    }

    console.log(`\n✅ Done. ${count} orders published to "${QUEUE_NAME}" queue.`);

    setTimeout(() => {
        conn.close();
        process.exit(0);
    }, 500);
})();
