const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();

describe('Location Access Control and Filtering', function () {
  let dbMock;
  let masterDataService;
  let locationService;

  beforeEach(function () {
    // Setup dbMock with custom query stub logic
    dbMock = {
      query: (sql, params, callback) => {
        // Default to returning an empty array synchronously
        callback(null, []);
      }
    };

    // Load masterDataService with stubbed db
    masterDataService = proxyquire('../src/services/masterDataService', {
      '../db': dbMock,
      './auditLogger': { logAudit: async () => {} },
      '../modules/tickets/repositories/mysql': {
        withTransaction: async (work) => {
          return work({
            query: async (sql, params) => {
              return new Promise((resolve, reject) => {
                dbMock.query(sql, params, (err, rows) => {
                  if (err) return reject(err);
                  resolve(rows);
                });
              });
            }
          });
        }
      }
    });

    // Load locationService with stubbed db/repo and masterDataService
    locationService = proxyquire('../src/modules/tickets/services/locationService', {
      '../repositories/mysql': {
        query: (sql, params) => {
          return new Promise((resolve, reject) => {
            dbMock.query(sql, params, (err, rows) => {
              if (err) return reject(err);
              resolve(rows);
            });
          });
        }
      },
      '../../../services/masterDataService': masterDataService
    });
  });

  describe('masterDataService - getAllowedLocationIds', function () {
    it('returns null if there are no mapped locations in engineer_mapping or users', async function () {
      dbMock.query = (sql, params, callback) => {
        callback(null, []);
      };

      const result = await masterDataService.getAllowedLocationIds(1, 10);
      expect(result).to.be.null;
    });

    it('retrieves and aggregates mapped locations from engineer_mapping and users', async function () {
      dbMock.query = (sql, params, callback) => {
        const queryStr = String(sql).toLowerCase();
        if (queryStr.includes('from engineer_mapping')) {
          callback(null, [{ state_id: 1, region_id: 2, cluster_id: null, branch_id: null }]);
        } else if (queryStr.includes('from users')) {
          callback(null, [{ state_id: null, region_id: null, cluster_id: 3, branch_id: 4 }]);
        } else if (queryStr.includes('select distinct id from states')) {
          callback(null, [{ id: 1 }]);
        } else if (queryStr.includes('select distinct id from regions')) {
          callback(null, [{ id: 2 }]);
        } else if (queryStr.includes('select distinct id from clusters')) {
          callback(null, [{ id: 3 }]);
        } else if (queryStr.includes('select distinct id from branches')) {
          callback(null, [{ id: 4 }]);
        } else {
          callback(null, []);
        }
      };

      const result = await masterDataService.getAllowedLocationIds(1, 10);
      expect(result).to.not.be.null;
      expect(result.states).to.deep.equal([1]);
      expect(result.regions).to.deep.equal([2]);
      expect(result.clusters).to.deep.equal([3]);
      expect(result.branches).to.deep.equal([4]);
    });
  });

  describe('masterDataService - listStates', function () {
    it('bypasses restrictions for SUPER_ADMIN role', async function () {
      let querySql = '';
      dbMock.query = (sql, params, callback) => {
        if (String(sql).trim().toUpperCase().startsWith('SELECT ID, NAME, STATUS FROM STATES')) {
          querySql = sql;
          callback(null, [{ id: 1, name: 'State A', status: 'ACTIVE' }]);
        } else {
          callback(null, [{ total: 1 }]);
        }
      };

      const user = { role: 'SuperAdmin', _id: 10, tenant_id: 1 };
      const res = await masterDataService.listStates(1, {}, user);
      expect(res.items).to.have.lengthOf(1);
      expect(querySql).to.not.include('id IN (?)');
    });

    it('bypasses restrictions for IT_ADMIN role', async function () {
      let querySql = '';
      dbMock.query = (sql, params, callback) => {
        if (String(sql).trim().toUpperCase().startsWith('SELECT ID, NAME, STATUS FROM STATES')) {
          querySql = sql;
          callback(null, [{ id: 1, name: 'State A', status: 'ACTIVE' }]);
        } else {
          callback(null, [{ total: 1 }]);
        }
      };

      const user = { role: 'IT Admin', _id: 10, tenant_id: 1 };
      const res = await masterDataService.listStates(1, {}, user);
      expect(res.items).to.have.lengthOf(1);
      expect(querySql).to.not.include('id IN (?)');
    });

    it('filters states by allowed locations for non-admin roles', async function () {
      let querySql = '';
      let queryParams = [];
      dbMock.query = (sql, params, callback) => {
        const queryStr = String(sql).toLowerCase();
        if (queryStr.includes('from engineer_mapping')) {
          callback(null, [{ state_id: 5, region_id: null, cluster_id: null, branch_id: null }]);
        } else if (queryStr.includes('from users')) {
          callback(null, []);
        } else if (queryStr.includes('select distinct id from states')) {
          callback(null, [{ id: 5 }]);
        } else if (queryStr.includes('select distinct id from regions')) {
          callback(null, []);
        } else if (queryStr.includes('select distinct id from clusters')) {
          callback(null, []);
        } else if (queryStr.includes('select distinct id from branches')) {
          callback(null, []);
        } else if (queryStr.startsWith('\n      select id, name, status from states')) {
          querySql = sql;
          queryParams = params;
          callback(null, [{ id: 5, name: 'State E', status: 'ACTIVE' }]);
        } else {
          callback(null, [{ total: 1 }]);
        }
      };

      const user = { role: 'Employee', _id: 10, tenant_id: 1 };
      const res = await masterDataService.listStates(1, {}, user);
      expect(res.items).to.have.lengthOf(1);
      expect(res.items[0].id).to.equal(5);
      expect(querySql).to.include('id IN (?)');
      // The parameter for allowed states should be array [5]
      expect(queryParams).to.deep.include([5]);
    });
  });

  describe('locationService - getHierarchy', function () {
    it('bypasses restrictions for SUPER_ADMIN role', async function () {
      dbMock.query = (sql, params, callback) => {
        callback(null, [{ id: 10, state_id: 1, region_id: 2, cluster_id: 3, branch_id: 4 }]);
      };

      const user = { role: 'SuperAdmin', _id: 10, tenant_id: 1 };
      const hierarchy = await locationService.getHierarchy(1, user);
      expect(hierarchy).to.be.an('array');
      expect(hierarchy).to.have.lengthOf(1);
    });

    it('filters branches for standard users', async function () {
      dbMock.query = (sql, params, callback) => {
        const queryStr = String(sql).toLowerCase();
        if (queryStr.includes('from engineer_mapping')) {
          callback(null, [{ state_id: 10, region_id: 20, cluster_id: 30, branch_id: 40 }]);
        } else if (queryStr.includes('from users')) {
          callback(null, []);
        } else if (queryStr.includes('select distinct id from states')) {
          callback(null, [{ id: 10 }]);
        } else if (queryStr.includes('select distinct id from regions')) {
          callback(null, [{ id: 20 }]);
        } else if (queryStr.includes('select distinct id from clusters')) {
          callback(null, [{ id: 30 }]);
        } else if (queryStr.includes('select distinct id from branches')) {
          callback(null, [{ id: 40 }]);
        } else if (queryStr.includes('from branches b')) {
          expect(sql).to.include('b.id IN (?)');
          expect(params).to.deep.include([40]);
          callback(null, [{ id: 40, state_id: 10, region_id: 20, cluster_id: 30, branch_id: 40 }]);
        } else {
          callback(null, []);
        }
      };

      const user = { role: 'Employee', _id: 10, tenant_id: 1 };
      const hierarchy = await locationService.getHierarchy(1, user);
      expect(hierarchy).to.be.an('array');
      expect(hierarchy).to.have.lengthOf(1);
      expect(hierarchy[0].branch_id).to.equal(40);
    });
  });

  describe('masterDataService - deleteBranch (Permanent Delete)', function () {
    it('throws error if branch not found', async function () {
      dbMock.query = (sql, params, callback) => {
        callback(null, []);
      };

      try {
        await masterDataService.deleteBranch(1, 999, 10);
        throw new Error('Should have failed');
      } catch (err) {
        expect(err.message).to.equal('Branch not found');
      }
    });

    it('performs a transaction and deletes the branch, updating referencing rows to NULL', async function () {
      const executedQueries = [];
      dbMock.query = (sql, params, callback) => {
        const queryStr = String(sql).toLowerCase();
        if (queryStr.includes('select id, cluster_id, name, status from branches')) {
          callback(null, [{ id: 40, cluster_id: 30, name: 'Branch A', status: 'ACTIVE' }]);
        } else {
          executedQueries.push({ sql, params });
          callback(null, { affectedRows: 1 });
        }
      };

      const res = await masterDataService.deleteBranch(1, 40, 10);
      expect(res).to.deep.equal({ id: 40, deleted: true, permanentDelete: true });
      
      // Verify that three updates and one delete query were executed
      expect(executedQueries).to.have.lengthOf(4);
      
      const sqls = executedQueries.map(eq => eq.sql.toLowerCase());
      expect(sqls[0]).to.include('update tickets set branch_id = null');
      expect(sqls[1]).to.include('update users set branch_id = null');
      expect(sqls[2]).to.include('update engineer_mapping set branch_id = null');
      expect(sqls[3]).to.include('delete from branches');
    });
  });
});
