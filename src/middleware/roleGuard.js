/**
 * src/middleware/roleGuard.js
 *
 * Factory functions that return Express middleware for role-based access.
 * Must run AFTER authMiddleware (depends on req.role / req.departmentId).
 *
 * Usage:
 *   router.get('/admin-only', authMiddleware, requireRole('admin'), handler);
 *   router.get('/dept-data',  authMiddleware, requireDepartmentAccess, handler);
 */

'use strict';

/**
 * requireRole(...allowedRoles)
 * Accepts one or more roles. Returns 403 if req.role is not in the list.
 *
 * @param {...('admin'|'head'|'staff'|'student')} roles
 */
function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.role) {
      return res.status(403).json({
        error: 'Access denied.',
        code:  'AUTHZ_NO_ROLE',
      });
    }
    if (!roles.includes(req.role)) {
      return res.status(403).json({
        error: `This action requires one of these roles: ${roles.join(', ')}.`,
        code:  'AUTHZ_WRONG_ROLE',
      });
    }
    next();
  };
}

/**
 * requireDepartmentAccess
 * Allows admins unconditionally.
 * For heads/staff, requires that req.departmentId matches the :deptId route param
 * OR the department_id field in the request body.
 */
function requireDepartmentAccess(req, res, next) {
  if (req.role === 'admin') return next();

  if (req.role !== 'head' && req.role !== 'staff') {
    return res.status(403).json({
      error: 'Department staff access required.',
      code:  'AUTHZ_NOT_DEPT_STAFF',
    });
  }

  const targetDept =
    req.params.deptId ||
    req.params.id     ||
    req.body?.department_id;

  if (!req.departmentId || req.departmentId !== targetDept) {
    return res.status(403).json({
      error: 'You can only manage your own department.',
      code:  'AUTHZ_WRONG_DEPT',
    });
  }

  next();
}

module.exports = { requireRole, requireDepartmentAccess };
