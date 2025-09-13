// Basic configuration for the concurrency test runner
export const BASE_URL = process.env.BASE_URL || 'http://app:3000'; // inside docker network
export const CONCURRENCY = Number(process.env.CONCURRENCY || 5); // limited by route rate limiter
export const SEATS_PER_BOOKING = Number(process.env.SEATS_PER_BOOKING || 3);
export const EVENT_CAPACITY = Number(process.env.EVENT_CAPACITY || 10);
export const EVENT_PRICE = Number(process.env.EVENT_PRICE || 100);
export const WAIT_TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS || 120000);
export const WAIT_INTERVAL_MS = Number(process.env.WAIT_INTERVAL_MS || 1500);
