import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'atomicseats-app',
  brokers: [process.env.KAFKA_BROKER || 'kafka:9092'],
});

const producer = kafka.producer();
const bookingConsumer = kafka.consumer({ groupId: 'booking-group' });
const notificationConsumer = kafka.consumer({ groupId: 'notification-group' });

export { kafka, producer, bookingConsumer, notificationConsumer };