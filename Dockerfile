# Use official Node.js LTS image
FROM node

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Pass DB URL from build args
ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}

# Run migrations
RUN npm run db:generate
RUN npm run db:migrate

# Start the application
CMD ["node", "server.js"]
