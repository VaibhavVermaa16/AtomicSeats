const { User, Event, Seat } = require('../models');

// Base controller class with common CRUD operations
class BaseController {
  constructor(model) {
    this.model = model;
  }

  // Get all records
  async getAll(req, res, next) {
    try {
      const { page = 1, limit = 10, ...filters } = req.query;
      const offset = (page - 1) * limit;

      const records = await this.model.findAll(
        filters,
        parseInt(limit),
        offset
      );

      res.status(200).json({
        success: true,
        data: records,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: records.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Get record by ID
  async getById(req, res, next) {
    try {
      const { id } = req.params;
      const record = await this.model.findById(id);

      if (!record) {
        return res.status(404).json({
          success: false,
          message: 'Record not found',
        });
      }

      res.status(200).json({
        success: true,
        data: record,
      });
    } catch (error) {
      next(error);
    }
  }

  // Create new record
  async create(req, res, next) {
    try {
      const record = await this.model.create(req.body);

      res.status(201).json({
        success: true,
        data: record,
        message: 'Record created successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  // Update record by ID
  async update(req, res, next) {
    try {
      const { id } = req.params;
      const record = await this.model.updateById(id, req.body);

      if (!record) {
        return res.status(404).json({
          success: false,
          message: 'Record not found',
        });
      }

      res.status(200).json({
        success: true,
        data: record,
        message: 'Record updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  // Delete record by ID
  async delete(req, res, next) {
    try {
      const { id } = req.params;
      const record = await this.model.deleteById(id);

      if (!record) {
        return res.status(404).json({
          success: false,
          message: 'Record not found',
        });
      }

      res.status(200).json({
        success: true,
        message: 'Record deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}

// User controller
class UserController extends BaseController {
  constructor() {
    super(new User());
  }

  // Custom method to get user by email
  async getByEmail(req, res, next) {
    try {
      const { email } = req.params;
      const user = await this.model.findByEmail(email);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      res.status(200).json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }
}

// Event controller
class EventController extends BaseController {
  constructor() {
    super(new Event());
  }

  // Custom method to get active events
  async getActiveEvents(req, res, next) {
    try {
      const events = await this.model.findActiveEvents();

      res.status(200).json({
        success: true,
        data: events,
      });
    } catch (error) {
      next(error);
    }
  }
}

// Seat controller
class SeatController extends BaseController {
  constructor() {
    super(new Seat());
  }

  // Custom method to get available seats for an event
  async getAvailableSeats(req, res, next) {
    try {
      const { eventId } = req.params;
      const seats = await this.model.findAvailableSeats(eventId);

      res.status(200).json({
        success: true,
        data: seats,
      });
    } catch (error) {
      next(error);
    }
  }
}

// Initialize controllers
const userController = new UserController();
const eventController = new EventController();
const seatController = new SeatController();

module.exports = {
  userController,
  eventController,
  seatController,
};
