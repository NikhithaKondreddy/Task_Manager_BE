const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();

describe('SLA Service', function () {
  it('throws when updating priority to one already used by another policy', async function () {
    // stubbed query to simulate DB responses
    const queryStub = async (sql, params) => {
      const s = String(sql).trim().toUpperCase();
      if (s.startsWith('SELECT * FROM TICKET_SLA_POLICIES WHERE TENANT_ID = ? AND ID = ?')) {
        return [{ id: 1, priority: 'MEDIUM', response_time_minutes: 10, resolution_time_minutes: 60, escalation_time_minutes: 30, is_active: 1 }];
      }
      if (s.startsWith('SELECT ID FROM TICKET_SLA_POLICIES WHERE TENANT_ID = ? AND UPPER(PRIORITY) = UPPER(?) AND ID != ?')) {
        return [{ id: 2 }]; // simulate duplicate exists
      }
      // default: no rows
      return [];
    };

    const mockAuditLogger = { logAudit: async () => {} };

    const slaService = proxyquire('../src/modules/tickets/services/slaService', {
      '../repositories/mysql': { query: queryStub },
      '../../../services/auditLogger': mockAuditLogger,
    });

    try {
      await slaService.updatePolicy(1, 1, { priority: 'MEDIUM' }, { _id: 10 });
      throw new Error('Expected updatePolicy to throw on duplicate priority');
    } catch (err) {
      expect(err).to.have.property('status', 400);
      expect(err.message).to.match(/already exists/i);
    }
  });
});
