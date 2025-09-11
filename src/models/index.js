const { pool } = require('../config/database');

// Base model class with common database operations
class BaseModel {
  constructor(tableName) {
    this.tableName = tableName;
    this.db = pool;
  }

  // Find all records
  async findAll(conditions = {}, limit = 100, offset = 0) {
    try {
      let query = `SELECT * FROM ${this.tableName}`;
      const values = [];

      if (Object.keys(conditions).length > 0) {
        const whereClause = Object.keys(conditions)
          .map((key, index) => `${key} = $${index + 1}`)
          .join(' AND ');
        query += ` WHERE ${whereClause}`;
        values.push(...Object.values(conditions));
      }

      query += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
      values.push(limit, offset);

      const result = await this.db.query(query, values);
      return result.rows;
    } catch (error) {
      throw new Error(`Error finding records: ${error.message}`);
    }
  }

  // Find record by ID
  async findById(id) {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      throw new Error(`Error finding record by ID: ${error.message}`);
    }
  }

  // Create new record
  async create(data) {
    try {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');

      const query = `
        INSERT INTO ${this.tableName} (${keys.join(', ')})
        VALUES (${placeholders})
        RETURNING *
      `;

      const result = await this.db.query(query, values);
      return result.rows[0];
    } catch (error) {
      throw new Error(`Error creating record: ${error.message}`);
    }
  }

  // Update record by ID
  async updateById(id, data) {
    try {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const setClause = keys
        .map((key, index) => `${key} = $${index + 2}`)
        .join(', ');

      const query = `
        UPDATE ${this.tableName}
        SET ${setClause}
        WHERE id = $1
        RETURNING *
      `;

      const result = await this.db.query(query, [id, ...values]);
      return result.rows[0] || null;
    } catch (error) {
      throw new Error(`Error updating record: ${error.message}`);
    }
  }

  // Delete record by ID
  async deleteById(id) {
    try {
      const query = `DELETE FROM ${this.tableName} WHERE id = $1 RETURNING *`;
      const result = await this.db.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      throw new Error(`Error deleting record: ${error.message}`);
    }
  }
}

// Example User model
class User extends BaseModel {
  constructor() {
    super('users');
  }

  // Custom method for finding user by email
  async findByEmail(email) {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE email = $1`;
      const result = await this.db.query(query, [email]);
      return result.rows[0] || null;
    } catch (error) {
      throw new Error(`Error finding user by email: ${error.message}`);
    }
  }
}

// Example Event model
class Event extends BaseModel {
  constructor() {
    super('events');
  }

  // Custom method for finding active events
  async findActiveEvents() {
    try {
      const query = `
        SELECT * FROM ${this.tableName}
        WHERE status = 'active' AND event_date > NOW()
        ORDER BY event_date ASC
      `;
      const result = await this.db.query(query);
      return result.rows;
    } catch (error) {
      throw new Error(`Error finding active events: ${error.message}`);
    }
  }
}

// Example Seat model
class Seat extends BaseModel {
  constructor() {
    super('seats');
  }

  // Custom method for finding available seats for an event
  async findAvailableSeats(eventId) {
    try {
      const query = `
        SELECT * FROM ${this.tableName}
        WHERE event_id = $1 AND status = 'available'
        ORDER BY row_number, seat_number
      `;
      const result = await this.db.query(query, [eventId]);
      return result.rows;
    } catch (error) {
      throw new Error(`Error finding available seats: ${error.message}`);
    }
  }
}

module.exports = {
  BaseModel,
  User,
  Event,
  Seat,
};
