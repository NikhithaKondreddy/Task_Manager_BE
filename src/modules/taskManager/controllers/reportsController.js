const ExcelJS = require('exceljs');
const { success } = require('../../../utils/response');
const reportRepo = require('../repos/reportRepo');
const { normalizeRole } = require('../../../config/rbac');
const { getManagerTeamUserIds } = require('../utils/teamScope');

async function scopedUserIds(req) {
  const role = normalizeRole(req.user.role);
  if (role === 'MANAGER') return getManagerTeamUserIds(req.user._id, req.user.tenant_id);
  return null;
}

async function exportXlsx(res, rows, sheetName, filename) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  if (rows.length) {
    sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key, width: 20 }));
    sheet.addRows(rows);
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

async function taskSummary(req, res) {
  const report = await reportRepo.taskSummary(req.user.tenant_id, { fromDate: req.query.fromDate, toDate: req.query.toDate });
  return success(res, report);
}

async function employeePerformance(req, res) {
  const userIds = await scopedUserIds(req);
  const report = await reportRepo.employeePerformance(req.user.tenant_id, userIds);
  if (req.query.format === 'xlsx') return exportXlsx(res, report, 'Employee Performance', 'employee-performance.xlsx');
  return success(res, report);
}

async function completion(req, res) {
  const days = parseInt(req.query.days, 10) || 30;
  const report = await reportRepo.completionTrend(req.user.tenant_id, days);
  return success(res, report);
}

async function recurring(req, res) {
  const report = await reportRepo.recurringTaskReport(req.user.tenant_id);
  if (req.query.format === 'xlsx') return exportXlsx(res, report, 'Recurring Tasks', 'recurring-tasks.xlsx');
  return success(res, report);
}

async function gembaWalk(req, res) {
  const report = await reportRepo.gembaWalkReport(req.user.tenant_id);
  if (req.query.format === 'xlsx') return exportXlsx(res, report, 'Gemba Walk', 'gemba-walk.xlsx');
  return success(res, report);
}

async function approvals(req, res) {
  const report = await reportRepo.approvalReport(req.user.tenant_id);
  return success(res, report);
}

module.exports = { taskSummary, employeePerformance, completion, recurring, gembaWalk, approvals };
