# Use official Node.js LTS image
FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Pass DB URL from build args
ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}

# No default CMD, let docker-compose.yml define it