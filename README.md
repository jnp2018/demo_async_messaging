# Async Messaging — Live Demo

Demo trực quan so sánh **Synchronous** vs **Asynchronous Messaging** sử dụng RabbitMQ.

## Yêu cầu

- Docker Desktop (đang chạy)
- Node.js ≥ 18

## Khởi động

```bash
# 1. Start RabbitMQ + Server
docker-compose up --build

# 2. Mở trình duyệt
open http://localhost:3000
```

## Chạy Consumer (terminal riêng)

```bash
# Consumer 1
node consumer.js Worker-1

# Consumer 2 (scale demo)
node consumer.js Worker-2

# Tuỳ chỉnh tốc độ xử lý (ms)
node consumer.js Worker-3 500
```

## Gửi message bằng CLI (tuỳ chọn)

```bash
# Gửi 20 orders, delay 100ms giữa mỗi order
node producer.js 20 100
```

## Demo trên UI

| Bước | Hành động | Mục đích |
|------|-----------|----------|
| 1 | Bấm **⚡ Burst 10** (chưa chạy consumer) | Queue tích luỹ, badge trên Broker tăng |
| 2 | Chạy `node consumer.js Worker-1` | Orders được xử lý, worker card hiện lên |
| 3 | Chạy `node consumer.js Worker-2` | Load phân tán giữa 2 consumer |
| 4 | Bật **Simulate Email Failure** | Async vẫn hoạt động, Sync bị timeout |

> Hoặc dùng **Demo Steps** sidebar (cạnh phải màn hình) để chạy từng bước tự động.

## Các URL

| Service | URL |
|---------|-----|
| Demo UI | http://localhost:3000 |
| RabbitMQ Management | http://localhost:15672 (guest/guest) |

## Dừng

```bash
docker-compose down
```
