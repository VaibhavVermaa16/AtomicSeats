import { createClient } from 'redis';

const client = createClient({
    username: 'default',
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
    },
});
client.on('error', (err) => console.log('Redis Client Error', err));

client.connect().then(() => {
    console.log('Redis connected...');
});

export { client };
