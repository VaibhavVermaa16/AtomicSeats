import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'atomicseats-app',
  brokers: [process.env.KAFKA_BROKER || 'kafka:9092'],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'booking-group' });

export { kafka, producer, consumer };