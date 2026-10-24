import { StaffMenuEntry, StaffRole, homeFor, menuEntries, menuFor } from './staff-menu';
import { INCENTIVE_TYPES } from './schemes/incentives.api';

describe('staff menu', () => {
  const labels = (roleId: number, subRoles: string[]) => menuFor(roleId, subRoles).map((i) => i.label);

  it('shows agencies only the allotment screens of their sub-roles', () => {
    const desktopOnly = labels(StaffRole.Agency, ['DesktopVerification']);
    expect(desktopOnly).toContain('DA Allotment');
    expect(desktopOnly).not.toContain('SA Allotment');
    expect(desktopOnly).toContain('Monitoring');
    expect(desktopOnly).not.toContain('Financial Assistance');

    const none = labels(StaffRole.Agency, []);
    expect(none).not.toContain('Monitoring');
    expect(none).toContain('Assessors');
  });

  it('always shows assessors Completed, Non-Conformances and Rejected', () => {
    const l = labels(StaffRole.DesktopAssessor, []);
    expect(l).toEqual(expect.arrayContaining(['Completed', 'Non-Conformances', 'Rejected Certification']));
    expect(l).not.toContain('Desktop Verification');
  });

  it('gives state coordinators the NEFT screens and reports only', () => {
    expect(labels(StaffRole.StateCoordinator, ['DesktopVerification', 'SiteVerification', 'FinancialVerification'])).toEqual([
      'Reports',
      'NEFT: New Transactions',
      'NEFT: Approved Transactions',
      'NEFT: Rejected Transactions',
    ]);
  });

  it('gives an unknown role nothing', () => {
    expect(menuFor(12, [])).toEqual([]);
  });

  describe('consultancy', () => {
    const c = (roleId: number, subRoles: string[]) => menuFor(roleId, subRoles, 'consultancy').map((i) => i.label);

    it('gives the master admin allotment, the CO and consultant lists and TU', () => {
      expect(c(StaffRole.MasterAdmin, [])).toEqual(expect.arrayContaining([
        'Allot Consultancy', 'Consultant Organisations', 'Consultants', 'Payment Received', 'Monitoring', 'Consultancy Completed',
        'Technology Upgradation',
      ]));
    });

    it('gives a CO the handholding screens with site verification and TU with financial verification', () => {
      const site = c(StaffRole.Agency, ['SiteVerification']);
      expect(site).toEqual(expect.arrayContaining(['Allot Consultancy', 'Consultancy Monitoring', 'Consultants/Experts', 'Reports']));
      expect(site).not.toContain('Technology Upgradation');
      expect(c(StaffRole.Agency, ['FinancialVerification'])).toEqual(['Consultants/Experts', 'Reports', 'Technology Upgradation', 'Sub-Users']);
    });

    it('gives consultants the milestone lists, pointing at the site-assessment routes', () => {
      const items = menuFor(StaffRole.DesktopAssessor, ['SiteVerification'], 'consultancy');
      expect(items.filter((i) => i.label.startsWith('Milestone')).map((i) => i.route)).toEqual([
        '/staff/site-assessment/milestones/1', '/staff/site-assessment/milestones/2', '/staff/site-assessment/milestones/3',
      ]);
    });

    it('has no categories, technologies masters or legacy links', () => {
      const admin = c(StaffRole.Admin, []);
      expect(admin).toEqual(['Upload Image', 'My Documents', 'Sectors', 'Payments', 'Bronze', 'Silver', 'Gold', 'User Management', 'Captcha Settings', 'Email Settings']);
      expect(menuFor(StaffRole.MasterAdmin, [], 'consultancy').every((i) => i.route && !i.legacyPath)).toBe(true);
    });

    it('lands admins on the questionnaire and coordinators on NEFT', () => {
      expect(homeFor(StaffRole.Admin, 'consultancy')).toBe('/staff/masters/parameters/Bronze');
      expect(homeFor(StaffRole.StateCoordinator, 'consultancy')).toBe('/staff/neft/new');
      expect(homeFor(StaffRole.Ministry, 'consultancy')).toBe('/staff/dashboard');
    });
  });

  describe('surveillance', () => {
    const s = (roleId: number, subRoles: string[]) => menuFor(roleId, subRoles, 'surveillance').map((i) => i.label);

    it('gives the master admin the surveillance screens and agency view', () => {
      expect(s(StaffRole.MasterAdmin, [])).toEqual(expect.arrayContaining([
        'Allot Surveillance', 'Bronze Surveillance Agencies', 'Surveillance Payment Received', 'Surveillance Monitoring',
        'Surveillance Completed', 'Surveillance Rejected',
      ]));
    });

    it('splits agency allotment by sub-role and has no NEFT', () => {
      expect(s(StaffRole.Agency, ['DesktopVerification'])).toContain('Allot Surveillance');
      expect(s(StaffRole.Agency, ['DesktopVerification'])).not.toContain('Allot Surveillance (Site)');
      expect(s(StaffRole.StateCoordinator, [])).toEqual([]);
      expect(homeFor(StaffRole.Admin, 'surveillance')).toBe('/staff/fees');
      expect(homeFor(StaffRole.StateCoordinator, 'surveillance')).toBeNull();
    });
  });

  describe('menu bar drop-downs (the old layout grouped the long menus)', () => {
    const bar = (roleId: number, system: 'main' | 'consultancy' | 'surveillance') =>
      menuEntries(menuFor(roleId, [], system)).map((e: StaffMenuEntry) => ('group' in e ? `${e.group} (${e.items.length})` : e.item.label));

    it('folds MasterAdmin and Admin menus into one row of entries', () => {
      // As the old layouts: the house icon is the dashboard link; the old drop-downs with their names.
      expect(bar(StaffRole.MasterAdmin, 'main')).toEqual(['Assessment (10)', 'Financial Assistance', 'Upload API Incentives', 'Operation Admins']);
      expect(bar(StaffRole.Admin, 'main')).toEqual([
        'Upload Image', 'My Documents', 'Sectors', 'Payments', 'Questionnaire (3)', 'Technology Upgradation (2)', `Incentives (${INCENTIVE_TYPES.length})`, 'User Management', 'Settings (2)',
      ]);
      expect(bar(StaffRole.Admin, 'consultancy')).toEqual(['Upload Image', 'My Documents', 'Sectors', 'Payments', 'Questionnaire (3)', 'User Management', 'Settings (2)']);
      expect(bar(StaffRole.Admin, 'surveillance')).toEqual(['Payments', 'Sectors', 'Questionnaire (3)', 'User Management', 'Settings (2)']);
      // Each incentive type is its own entry: the same page with ?type=.
      expect(menuFor(StaffRole.Admin, [], 'main').find((i) => i.label === 'ASSAM')?.queryParams).toEqual({ type: 'ASSAM' });
      expect(bar(StaffRole.MasterAdmin, 'consultancy')).toEqual(['Allot Consultancy', 'Consultancy Monitoring (6)', 'Technology Upgradation', 'Operation Admins']);
      expect(bar(StaffRole.MasterAdmin, 'surveillance')).toEqual(['Allot Surveillance', 'Surveillance Monitoring (7)', 'Operation Admins']);
    });

    it('leaves the other roles flat, as before', () => {
      expect(menuEntries(menuFor(StaffRole.DesktopAssessor, ['DesktopVerification', 'SiteVerification'], 'main')).every((e) => 'item' in e)).toBe(true);
      expect(menuEntries(menuFor(StaffRole.Agency, ['DesktopVerification', 'SiteVerification'], 'surveillance')).every((e) => 'item' in e)).toBe(true);
    });
  });
  describe('sub-users', () => {
    it('get only the screens their owner gave them, without user management', () => {
      const labels = (role: number, subs: string[], routes: string[], system: 'main' | 'consultancy' | 'surveillance' = 'main') =>
        menuFor(role, subs, system, routes).map((i) => i.label);
      expect(labels(StaffRole.MasterAdmin, [], ['/staff/assessment/allot', '/staff/assessment/completed', '/staff/assessment/rejected'])).toEqual([
        'Allot Assessment', 'Assessment Completed', 'Rejected Certification',
      ]);
      expect(labels(StaffRole.Agency, ['DesktopVerification'], ['/staff/users/my-assessors', '/staff/users/assessors'])).toEqual(['Assessors']);
      expect(labels(StaffRole.Agency, ['DesktopVerification'], [])).toEqual([]);
      // Owners keep the whole menu.
      expect(menuFor(StaffRole.Agency, ['DesktopVerification'], 'main', null).map((i) => i.label)).toContain('Sub-Users');
    });
  });
});
