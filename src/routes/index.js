const express = require('express');
const {
  userController,
  eventController,
  seatController,
} = require('../controllers');

const router = express.Router();

// API Info endpoint
router.get('/', (req, res) => {
  res.status(200).json({
    message: 'Welcome to AtomicSeats API',
    version: '1.0.0',
    endpoints: {
      users: '/api/users',
      events: '/api/events',
      seats: '/api/seats',
    },
    docs: 'API documentation coming soon',
  });
});

// User routes
router.get('/users', userController.getAll.bind(userController));
router.get('/users/:id', userController.getById.bind(userController));
router.get(
  '/users/email/:email',
  userController.getByEmail.bind(userController)
);
router.post('/users', userController.create.bind(userController));
router.put('/users/:id', userController.update.bind(userController));
router.delete('/users/:id', userController.delete.bind(userController));

// Event routes
router.get('/events', eventController.getAll.bind(eventController));
router.get(
  '/events/active',
  eventController.getActiveEvents.bind(eventController)
);
router.get('/events/:id', eventController.getById.bind(eventController));
router.post('/events', eventController.create.bind(eventController));
router.put('/events/:id', eventController.update.bind(eventController));
router.delete('/events/:id', eventController.delete.bind(eventController));

// Seat routes
router.get('/seats', seatController.getAll.bind(seatController));
router.get('/seats/:id', seatController.getById.bind(seatController));
router.get(
  '/seats/event/:eventId/available',
  seatController.getAvailableSeats.bind(seatController)
);
router.post('/seats', seatController.create.bind(seatController));
router.put('/seats/:id', seatController.update.bind(seatController));
router.delete('/seats/:id', seatController.delete.bind(seatController));

module.exports = router;
