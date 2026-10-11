/**
 * src/routes/departmentReviews.js
 *
 * Backward-compatible alias — delegates to the departments router.
 * Old mount point: app.use('/api/departments', departmentReviewsRouter)
 *
 * GET  /api/departments/:id/reviews
 * POST /api/departments/:id/reviews
 *
 * We keep this file so any existing import in server.js still works.
 */

'use strict';

module.exports = require('./departments');
