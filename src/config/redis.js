import { createClient } from 'redis';

const client = createClient({
    username: 'default',
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: 'redis-12976.c232.us-east-1-2.ec2.redns.redis-cloud.com',
        port: 12976
    }
});
client.on('error', err => console.log('Redis Client Error', err));

// await client.connect();
client.connect().then(() =>{
    console.log('Redis connected...');
})

export { client };
