// {
//     "schema": "./src/models",
//     "out": "./drizzle",
//     "dialect": "postgresql",
//     "dbCredentials": {
//         "host": "localhost",
//         "port": 5432,
//         "user": "atomicseats",
//         "password": "atomicseats123",
//         "database": "atomicseats",
//         "ssl": false
//     }
// }


import dotenv from "dotenv";

dotenv.config();

export default {
  schema: "./src/models",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL, // from .env
  },
};
